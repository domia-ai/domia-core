import { emitTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"
import { domiaBusLogger } from "@/utils"
import { RESPONSE_TYPE_ENUM, AUDIO_PLAYBACK_ENGINE_ENUM } from "@/db"
import { prewarmSoxPlayer } from "@/modules/audio-playback"
import {
	buildPromptContext,
	buildDelegationPersona,
} from "@/modules/prompt-context-builder"
import {
	streamLlmFromTarget,
	type DeliverEventTarget,
} from "@/modules/grpc-client"
import { isIdentitySlotBusy } from "@/modules/llm-slots"
import {
	takeMemoryBundle,
	prefetchMemoryBundle,
	createAsyncQueue,
	skillsMayIntercept,
	looksSkillish,
	prewarmFastPathPhrase,
} from "../../utils"
import type {
	CoreBusContextType,
	SpeculationType,
	SpeculativeTurnArgsType,
} from "../../types"
import { isCancelled, wireFirstUnitDivert } from "./helpers"

export const startSpeculation = (
	ctx: CoreBusContextType,
	args: SpeculativeTurnArgsType,
	generation: number,
	resolveTranscript: () => Promise<string>,
	llmTargets: DeliverEventTarget[] | null,
	onPartial?: (transcript: string) => void,
): SpeculationType => {
	const { domia, features } = ctx
	const specTts =
		domia.wakeWordConfig?.speculativeTtsEnabled === true &&
		features.canRunTts &&
		features.tts !== null
	const me: SpeculationType = {
		generation,
		cancelled: false,
		started: false,
		handedOff: false,
		queue: createAsyncQueue<string>(),
		outQueue: specTts ? createAsyncQueue<string>() : null,
		tokenSource: null,
		firstUnitText: null,
		firstUnitPcm: null,
		prompt: null,
		executorKey: null,
		llmQueuedAt: null,
		llmFirstTokenAt: null,
		ready: Promise.resolve(null),
	}
	me.ready = (async (): Promise<string | null> => {
		const transcript = await resolveTranscript()
		if (isCancelled(me)) return null
		if (!transcript.trim()) {
			domiaBusLogger.info(`🔮 speculation g${generation}: empty transcript`, {
				domiaId: domia.id,
			})
			return null
		}
		onPartial?.(transcript)
		if (
			skillsMayIntercept(domia) &&
			(prewarmFastPathPhrase(ctx, transcript) ||
				(await looksSkillish(domia, transcript)))
		) {
			domiaBusLogger.info(
				`🔮 speculation g${generation} skipped — skill-ish transcript ("${transcript.slice(0, 60)}")`,
				{ domiaId: domia.id },
			)
			me.queue.close()
			return transcript
		}
		if (isCancelled(me)) return null
		const bundle = await takeMemoryBundle(domia, args.interactionId)
		prefetchMemoryBundle(domia, args.interactionId)
		if (isCancelled(me)) return null
		me.prompt = buildPromptContext(domia, transcript, bundle)
		if (isIdentitySlotBusy(domia)) {
			domiaBusLogger.info(
				`🔮 speculation g${generation} rejected — identity slot busy`,
				{ domiaId: domia.id, interactionId: args.interactionId },
			)
			me.queue.close()
			return transcript
		}
		me.llmQueuedAt = Date.now()
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
							persona: buildDelegationPersona(domia, bundle),
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
					me.prompt,
					() => me.cancelled || me.queue.isClosed(),
				)
		if (!tokens || isCancelled(me)) {
			if (tokens)
				void (tokens as AsyncGenerator<string>)
					.return(undefined)
					.catch(() => undefined)
			me.queue.close()
			return isCancelled(me) ? null : transcript
		}
		me.tokenSource = tokens
		me.started = true
		emitTurnEvent({
			type: DOMIA_TURN_EVENT_ENUM.SPECULATION_STARTED,
			interactionId: args.interactionId,
			originDomiaKey: domia.domiaKey,
			executorKey: me.executorKey ?? undefined,
		})
		domiaBusLogger.info(
			`🔮 speculation g${generation}: ${llmTargets ? "delegated " : ""}LLM started ("${transcript.slice(0, 60)}")`,
			{ domiaId: domia.id, interactionId: args.interactionId },
		)
		wireFirstUnitDivert(ctx, me, args.interactionId)
		if (
			features.canPlayback &&
			features.tts &&
			domia.audioPlaybackConfig?.engine === AUDIO_PLAYBACK_ENGINE_ENUM.SOX
		) {
			prewarmSoxPlayer(domia, {
				sampleRate: features.tts.adapter.capabilities.sampleRate,
				channels: features.tts.adapter.capabilities.channels,
				bitsPerSample: 16,
			})
		}
		void (async () => {
			try {
				for await (const token of tokens) {
					if (me.cancelled || me.queue.isClosed()) break
					me.llmFirstTokenAt ??= Date.now()
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
	})().catch((err: unknown) => {
		domiaBusLogger.warn(`🔮 speculation g${generation}: failed`, {
			domiaId: domia.id,
			err,
		})
		me.queue.close()
		return null
	})
	return me
}
