import { domiaBusLogger } from "@/utils"
import { clearStreamingSink } from "./streaming-sink"
import { markLadderStage } from "./stage-ladder"
import type {
	InteractionRuntimeType,
	InteractionCompletionResultType,
	PartialResultType,
	CompletionHandleType,
	InteractionAudioPatchType,
	CompleteInteractionOptsType,
} from "../types"

const runtimes = new Map<string, InteractionRuntimeType>()

const safeCallback = (label: string, fn: () => void): void => {
	try {
		fn()
	} catch (err) {
		domiaBusLogger.warn(`interaction runtime callback failed (${label})`, {
			err,
		})
	}
}

const partials = new Map<string, PartialResultType>()

const completions = new Map<string, CompletionHandleType>()

const partialOf = (interactionId: string): PartialResultType => {
	let p = partials.get(interactionId)
	if (!p) {
		p = { transcript: "", reply: "" }
		partials.set(interactionId, p)
	}
	return p
}

export const registerInteractionRuntime = (
	runtime: InteractionRuntimeType,
): void => {
	runtimes.set(runtime.envelope.interactionId, runtime)
}

export const getInteractionRuntime = (
	interactionId: string,
): InteractionRuntimeType | undefined => runtimes.get(interactionId)

export const clearInteraction = (interactionId: string): void => {
	const handle = completions.get(interactionId)
	if (handle) {
		clearTimeout(handle.timeout)
		completions.delete(interactionId)
	}
	partials.delete(interactionId)
	runtimes.delete(interactionId)
	clearStreamingSink(interactionId)
}

export const INTERACTION_COMPLETION_TIMEOUT = "interaction completion timeout"

export const awaitInteractionResult = (
	interactionId: string,
	timeoutMs: number,
): Promise<InteractionCompletionResultType> =>
	new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			clearInteraction(interactionId)
			reject(new Error(INTERACTION_COMPLETION_TIMEOUT))
		}, timeoutMs)
		completions.set(interactionId, { resolve, reject, timeout })
	})

const elapsedOf = (rt: InteractionRuntimeType): number =>
	Date.now() - rt.timings.createdAt

export const pushInteractionTranscript = (
	interactionId: string,
	transcript: string,
): void => {
	const rt = runtimes.get(interactionId)
	if (!rt) return
	partialOf(interactionId).transcript = transcript
	safeCallback("onStage:stt", () =>
		rt.callbacks.onStage?.("stt", elapsedOf(rt)),
	)
	if (rt.delivery.wantsTranscript)
		safeCallback("onTranscript", () => rt.callbacks.onTranscript?.(transcript))
}

export const pushInteractionReply = (
	interactionId: string,
	reply: string,
): void => {
	const rt = runtimes.get(interactionId)
	if (!rt) return
	partialOf(interactionId).reply = reply
	safeCallback("onStage:llm", () =>
		rt.callbacks.onStage?.("llm", elapsedOf(rt)),
	)
}

export const pushInteractionFirstAudio = (interactionId: string): void => {
	markLadderStage(interactionId, "audioDeliveredAt")
	const rt = runtimes.get(interactionId)
	if (!rt || rt.timings.firstAudioAt) return
	rt.timings.firstAudioAt = Date.now()
	safeCallback("onStage:firstAudioChunk", () =>
		rt.callbacks.onStage?.("firstAudioChunk", elapsedOf(rt)),
	)
}

export const setInteractionAudio = (
	interactionId: string,
	audio: InteractionAudioPatchType,
): void => {
	if (!runtimes.has(interactionId)) return
	const p = partialOf(interactionId)
	if (audio.ttsFilePath !== undefined) p.ttsFilePath = audio.ttsFilePath
	if (audio.audioUrl !== undefined) p.audioUrl = audio.audioUrl
}

export const setInteractionTarget = (
	interactionId: string,
	targetDomiaKey: string,
): void => {
	const rt = runtimes.get(interactionId)
	if (!rt) return
	rt.envelope.targetDomiaKey = targetDomiaKey
}

const buildResult = (
	interactionId: string,
	interrupted: boolean,
	override?: Partial<InteractionCompletionResultType>,
): InteractionCompletionResultType => {
	const p = partials.get(interactionId)
	return {
		transcript: override?.transcript ?? p?.transcript ?? "",
		reply: override?.reply ?? p?.reply ?? "",
		ttsFilePath: override?.ttsFilePath ?? p?.ttsFilePath,
		audioUrl: override?.audioUrl ?? p?.audioUrl,
		interrupted,
	}
}

export const completeInteraction = (
	interactionId: string,
	opts: CompleteInteractionOptsType = {},
): void => {
	const rt = runtimes.get(interactionId)
	const handle = completions.get(interactionId)
	if (!rt && !handle) return
	const result = buildResult(
		interactionId,
		opts.interrupted ?? false,
		opts.result,
	)
	if (rt?.timings) rt.timings.completedAt = Date.now()
	const producedAudio =
		!!rt?.timings.firstAudioAt || !!result.ttsFilePath || !!result.audioUrl
	if (rt && producedAudio)
		safeCallback("onStage:tts", () =>
			rt.callbacks.onStage?.("tts", Date.now() - rt.timings.createdAt),
		)
	if (rt) safeCallback("onComplete", () => rt.callbacks.onComplete?.(result))
	if (handle) {
		clearTimeout(handle.timeout)
		handle.resolve(result)
	}
	clearInteraction(interactionId)
}

export const failInteraction = (
	interactionId: string,
	error: string,
	step?: string,
): void => {
	const rt = runtimes.get(interactionId)
	const handle = completions.get(interactionId)
	if (!rt && !handle) return
	if (rt) safeCallback("onError", () => rt.callbacks.onError?.(error, step))
	if (handle) {
		clearTimeout(handle.timeout)
		handle.reject(new Error(error))
	}
	clearInteraction(interactionId)
}
