import { publishToDomiaBus, DOMIA_EVENT_BUS_ENUM } from "@/buses"
import { getTraceContext } from "@/utils"
import { INTERACTION_INPUT_TYPE_ENUM, RESPONSE_TYPE_ENUM } from "@/db"
import type { DomiaType } from "@/modules/core"
import { reflectOnInteraction } from "@/modules/reflection"
import { getOrCreateInteractionId } from "@/modules/session-manager"
import { prefetchMemoryBundle } from "./prefetch-memory"
import { beginTurn } from "./turn-scope"
import { registerStreamingSink } from "./streaming-sink"
import { setPresenceStatus } from "./presence-registry"
import {
	registerInteractionRuntime,
	awaitInteractionResult,
	clearInteraction,
	INTERACTION_COMPLETION_TIMEOUT,
} from "./interaction-runtime"
import { persistInteractionTimeout } from "./helpers"
import type {
	InteractionInputType,
	RunInteractionInputType,
	InteractionCompletionResultType,
	InteractionRequestType,
	InteractionRuntimeOptionsType,
	BeginInteractionHandleType,
	RunInteractionOptionsType,
	RunInteractionResultType,
} from "../types"

const DEFAULT_TIMEOUT_MS = 60_000

const inputTypeOf = (input: InteractionInputType) =>
	input.kind === "text"
		? INTERACTION_INPUT_TYPE_ENUM.TEXT
		: INTERACTION_INPUT_TYPE_ENUM.VOICE

export const beginInteraction = async (
	domia: DomiaType,
	request: InteractionRequestType,
	runtimeOpts: InteractionRuntimeOptionsType,
): Promise<BeginInteractionHandleType | null> => {
	const responseType =
		request.requestedOutput.kind === "voice"
			? RESPONSE_TYPE_ENUM.VOICE
			: RESPONSE_TYPE_ENUM.TEXT

	const interactionId = await getOrCreateInteractionId(
		domia,
		request.interactionId,
		{
			inputType: inputTypeOf(request.input),
			responseType,
			inputAudioPath:
				request.input.kind === "audio_file"
					? request.input.filePath
					: undefined,
			inputAudioMs:
				request.input.kind === "audio_file"
					? request.input.inputAudioMs
					: undefined,
			satelliteId: request.satelliteId ?? null,
			satelliteProtocol: request.satelliteProtocol ?? null,
		},
		undefined,
		request.source,
	)
	if (!interactionId) return null

	if (runtimeOpts.prefetch) prefetchMemoryBundle(domia, interactionId)

	const turn = runtimeOpts.liveTurn ? beginTurn(domia.id, interactionId) : null
	if (runtimeOpts.liveTurn) setPresenceStatus(domia.domiaKey, "thinking", true)

	if (runtimeOpts.sink) registerStreamingSink(interactionId, runtimeOpts.sink)

	registerInteractionRuntime({
		envelope: {
			interactionId,
			traceId: getTraceContext()?.traceId,
			originDomiaKey: domia.domiaKey,
			runtimeDomiaKey: domia.domiaKey,
			satelliteId: request.satelliteId,
			source: request.source,
			input: request.input,
			requestedOutput: request.requestedOutput,
		},
		timings: { createdAt: runtimeOpts.createdAt ?? Date.now() },
		liveVoice: runtimeOpts.liveTurn,
		delivery: {
			audioDelivery: runtimeOpts.audioDelivery,
			wantsTranscript: runtimeOpts.wantsTranscript,
		},
		callbacks: {
			onStage: runtimeOpts.onStage,
			onTranscript: runtimeOpts.onTranscript,
			onComplete: runtimeOpts.onComplete,
			onError: runtimeOpts.onError,
		},
	})

	return { interactionId, turn }
}

export const publishInteractionInput = (
	domia: DomiaType,
	interactionId: string,
	input: RunInteractionInputType,
	responseType: (typeof RESPONSE_TYPE_ENUM)[keyof typeof RESPONSE_TYPE_ENUM],
): void => {
	if (input.kind === "audio_file") {
		publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.AUDIO_READY, {
			filePath: input.filePath,
			interactionId,
			originDomiaKey: domia.domiaKey,
			responseType,
		})
	} else {
		publishToDomiaBus(domia.id, DOMIA_EVENT_BUS_ENUM.STT_DONE, {
			transcript: input.kind === "transcript" ? input.transcript : input.text,
			interactionId,
			originDomiaKey: domia.domiaKey,
			responseType,
		})
	}
}

export const runInteraction = async (
	domia: DomiaType,
	options: RunInteractionOptionsType,
): Promise<RunInteractionResultType> => {
	const {
		input,
		requestedOutput,
		audioDelivery,
		source,
		interactionId: providedId,
		satelliteId,
		satelliteProtocol,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		onStage,
		liveTurn = false,
		prefetch = false,
		reflect = false,
	} = options

	const responseType =
		requestedOutput.kind === "voice"
			? RESPONSE_TYPE_ENUM.VOICE
			: RESPONSE_TYPE_ENUM.TEXT

	const handle = await beginInteraction(
		domia,
		{
			input,
			requestedOutput,
			source,
			interactionId: providedId,
			satelliteId,
			satelliteProtocol,
		},
		{
			audioDelivery,
			liveTurn,
			prefetch,
			onStage,
		},
	)
	if (!handle) {
		throw new Error("runInteraction: failed to create interaction")
	}
	const { interactionId, turn } = handle

	const completion = awaitInteractionResult(interactionId, timeoutMs)
	publishInteractionInput(domia, interactionId, input, responseType)

	let result: InteractionCompletionResultType
	try {
		result = await completion
	} catch (err) {
		const timedOut =
			err instanceof Error && err.message === INTERACTION_COMPLETION_TIMEOUT
		turn?.abort(timedOut ? "timeout" : "error")
		if (timedOut) persistInteractionTimeout(interactionId)
		throw err
	} finally {
		turn?.end()
		if (liveTurn) setPresenceStatus(domia.domiaKey, "idle", true)
		clearInteraction(interactionId)
	}

	if (reflect && result.transcript && result.reply) {
		void reflectOnInteraction(
			domia,
			result.transcript,
			result.reply,
			interactionId,
			domia.domiaKey,
		)
	}

	return { interactionId, ...result }
}
