import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { domiaBusLogger } from "@/utils"
import { CAPABILITY_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import { startSpeculativeCapture } from "@/modules/audio-capture"
import { updateInteraction } from "@/modules/session-manager"
import {
	buildPromptContext,
	personaContextFromDomia,
} from "@/modules/prompt-context-builder"
import { resolveCapabilityDelegations } from "@/modules/capability-resolver"
import {
	streamLlmFromTarget,
	type DeliverEventTarget,
} from "@/modules/grpc-client"
import type { SttStreamSessionType } from "@/modules/stt-engine"
import { takeMemoryBundle, AsyncQueue } from "../utils"
import type {
	CoreBusContextType,
	SpeculationType,
	SpeculativeTurnArgsType,
} from "../types"

const startSpeculation = (
	ctx: CoreBusContextType,
	args: SpeculativeTurnArgsType,
	generation: number,
	resolveTranscript: () => Promise<string>,
	llmTargets: DeliverEventTarget[] | null,
): SpeculationType => {
	const { domia, features } = ctx
	const me: SpeculationType = {
		generation,
		cancelled: false,
		started: false,
		queue: new AsyncQueue<string>(),
		prompt: null,
		executorKey: null,
		ready: Promise.resolve(null),
	}
	me.ready = (async (): Promise<string | null> => {
		const transcript = await resolveTranscript()
		if (me.cancelled) return null
		if (!transcript.trim()) {
			domiaBusLogger.info(`🔮 speculation g${generation}: empty transcript`, {
				domiaId: domia.id,
			})
			return null
		}
		const bundle = await takeMemoryBundle(domia, args.interactionId)
		if (me.cancelled) return null
		me.prompt = buildPromptContext(domia, transcript, bundle)
		const tokens = llmTargets
			? await (async () => {
					const streamed = await streamLlmFromTarget(
						domia.domiaKey,
						llmTargets,
						{
							transcript,
							originDomiaKey: domia.domiaKey,
							interactionId: args.interactionId,
							responseType: RESPONSE_TYPE_ENUM.VOICE,
							personaContextJson: JSON.stringify(
								personaContextFromDomia(
									domia,
									bundle.recentTurns,
									bundle.knownFacts,
									bundle.userMoodTrend,
								),
							),
						},
					)
					if (!streamed.delivered || !streamed.tokens) {
						domiaBusLogger.warn(
							`🔮 speculation g${generation}: delegated LLM not delivered (${streamed.error ?? "unknown"})`,
							{ domiaId: domia.id },
						)
						return null
					}
					me.executorKey = streamed.target?.domiaKey ?? null
					return streamed.tokens
				})()
			: features.llm?.adapter.runStream?.(
					domia,
					me.prompt ?? "",
					() => me.cancelled,
				)
		if (!tokens || me.cancelled) {
			me.queue.close()
			return me.cancelled ? null : transcript
		}
		me.started = true
		domiaBusLogger.info(
			`🔮 speculation g${generation}: ${llmTargets ? "delegated " : ""}LLM started ("${transcript.slice(0, 60)}")`,
			{ domiaId: domia.id, interactionId: args.interactionId },
		)
		void (async () => {
			try {
				for await (const token of tokens) {
					if (me.cancelled) break
					me.queue.push(token)
				}
			} catch (err) {
				domiaBusLogger.warn(`🔮 speculation g${generation}: LLM failed`, {
					domiaId: domia.id,
					err,
				})
			} finally {
				me.queue.close()
			}
		})()
		return transcript
	})().catch((err) => {
		domiaBusLogger.warn(`🔮 speculation g${generation}: failed`, {
			domiaId: domia.id,
			err,
		})
		me.queue.close()
		return null
	})
	return me
}

const normalizeWords = (text: string): string =>
	text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, "")
		.split(/\s+/)
		.filter(Boolean)
		.join(" ")

const transcriptsCompatible = (speculative: string, final: string): boolean =>
	normalizeWords(speculative) === normalizeWords(final)

const openSttSession = (
	ctx: CoreBusContextType,
): SttStreamSessionType | null => {
	const { domia, features } = ctx
	const create = features.stt?.adapter.createSession
	if (!create) return null
	try {
		const session = create(domia)
		domiaBusLogger.info(`🔮 incremental STT session open`, {
			domiaId: domia.id,
		})
		return session
	} catch (err) {
		domiaBusLogger.warn(
			`🔮 incremental STT unavailable — snapshot decode fallback`,
			{ domiaId: domia.id, err },
		)
		return null
	}
}

export const runSpeculativeTurn = async (
	ctx: CoreBusContextType,
	args: SpeculativeTurnArgsType,
): Promise<void> => {
	const { domia, features } = ctx
	let generation = 0
	let active: SpeculationType | null = null
	const stt = { session: openSttSession(ctx) }
	const llmTargets = features.canRunLlm
		? null
		: await resolveCapabilityDelegations(domia, CAPABILITY_ENUM.LLM).then(
				(targets) => (targets.length > 0 ? targets : null),
				() => null,
			)

	const rebuildSttSession = (pcm: Buffer): void => {
		if (!stt.session) return
		stt.session.reset(pcm)
	}

	const cancelActive = (reason: string): void => {
		if (!active) return
		domiaBusLogger.info(
			`🔮 speculation g${active.generation} cancelled (${reason})`,
			{ domiaId: domia.id, interactionId: args.interactionId },
		)
		active.cancelled = true
		active.queue.close()
		active = null
	}

	const capture = startSpeculativeCapture(domia, {
		onChunk: stt.session ? (pcm) => stt.session?.pushChunk(pcm) : undefined,
		onSpeculate: (pcm) => {
			cancelActive("superseded")
			generation += 1
			const session = stt.session
			active = startSpeculation(
				ctx,
				args,
				generation,
				session
					? () => session.flushPartial(domia.sttConfig?.decodePaddingMs ?? 600)
					: () =>
							features.stt?.adapter.runPcm?.(domia, pcm) ?? Promise.resolve(""),
				llmTargets,
			)
		},
		onResume: (pcm) => {
			cancelActive("speech resumed")
			rebuildSttSession(pcm)
		},
	})

	void capture.filePathPromise
		.then((filePath) =>
			updateInteraction({
				id: args.interactionId,
				inputAudioPath: filePath,
			}),
		)
		.catch((err) =>
			domiaBusLogger.warn("speculative capture: audio persistence failed", {
				domiaId: domia.id,
				err,
			}),
		)

	const finalPcm = await capture.finalPcmPromise
	const finalTranscript = stt.session ? await stt.session.finish() : null
	const winner = ((): SpeculationType | null => active)()
	if (winner && !winner.cancelled) {
		const transcript = await winner.ready
		if (transcript && !winner.cancelled) {
			const final = finalTranscript?.trim()
			if (final && !transcriptsCompatible(transcript, final)) {
				domiaBusLogger.info(
					`🔮 speculation g${winner.generation} discarded — final decode disagrees ("${transcript.slice(0, 40)}" vs "${final.slice(0, 40)}")`,
					{ domiaId: domia.id, interactionId: args.interactionId },
				)
			} else if (winner.started) {
				domiaBusLogger.info(
					`🔮 speculation g${winner.generation} confirmed — LLM already running`,
					{ domiaId: domia.id, interactionId: args.interactionId },
				)
				publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
					transcript: final || transcript,
					interactionId: args.interactionId,
					originDomiaKey: domia.domiaKey,
					prestartedTokens: winner.queue.iter(),
					prestartedPrompt: winner.prompt ?? undefined,
					prestartedExecutorKey: winner.executorKey ?? undefined,
					prestartedRelease: args.release,
					speechEndAt: capture.speechEndAt() ?? undefined,
					liveVoice: true,
				})
				return
			}
		}
	}

	cancelActive("final decode wins")
	const transcript =
		finalTranscript ??
		(await features.stt?.adapter.runPcm?.(domia, finalPcm)) ??
		""
	args.release()
	domiaBusLogger.info(`🔮 no usable speculation — normal turn`, {
		domiaId: domia.id,
		interactionId: args.interactionId,
	})
	publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
		transcript,
		interactionId: args.interactionId,
		originDomiaKey: domia.domiaKey,
		speechEndAt: capture.speechEndAt() ?? undefined,
		liveVoice: true,
	})
}
