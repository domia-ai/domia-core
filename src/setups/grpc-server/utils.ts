import { type DomiaType } from "@/modules/core"
import type { CoreBusFeaturesType } from "@/modules/core-bus/types"
import { splitSentences } from "@/modules/core-bus/utils/sentence-buffer"
import { runLLM } from "@/modules/llm-engine"
import { runTTS } from "@/modules/tts-engine"
import { wavFileToPcmChunks } from "@/utils"
import { DEFAULT_CHANNELS, DEFAULT_SAMPLE_RATE } from "./constants"

export const canStreamTts = (features: CoreBusFeaturesType): boolean =>
	!!(features.canStreamTts && features.tts?.adapter.runStream)

export const canStreamLlm = (features: CoreBusFeaturesType): boolean =>
	!!(features.canStreamLlm && features.llm?.adapter.runStream)

export const canPipelineReply = (features: CoreBusFeaturesType): boolean =>
	canStreamLlm(features) &&
	(canStreamTts(features) ||
		(features.canRunTts && !!features.tts?.adapter.run))

export const ttsCapsOrDefaults = (
	features: CoreBusFeaturesType,
): { sampleRate: number; channels: number } => ({
	sampleRate:
		features.tts?.adapter.capabilities.sampleRate ?? DEFAULT_SAMPLE_RATE,
	channels: features.tts?.adapter.capabilities.channels ?? DEFAULT_CHANNELS,
})

export const bytesToAudioMs = (
	bytes: number,
	sampleRate: number,
	channels: number,
): number => Math.round((bytes / (sampleRate * channels * 2)) * 1000)

export const ttsTextToChunks = async function* (
	domia: DomiaType,
	text: string,
	features: CoreBusFeaturesType,
): AsyncIterable<Buffer> {
	const ttsRunStream = features.tts?.adapter.runStream
	if (canStreamTts(features) && ttsRunStream) {
		yield* ttsRunStream(domia, text)
		return
	}
	const result = await runTTS(domia, text)
	if (!result?.filePath) return
	yield* wavFileToPcmChunks(result.filePath)
}

export const pipelinedReplyChunks = async function* (
	domia: DomiaType,
	promptContext: string,
	features: CoreBusFeaturesType,
	onSentence: (sentence: string) => void,
): AsyncIterable<Buffer> {
	const llmRunStream = features.llm?.adapter.runStream
	if (!llmRunStream) return
	const tokens = llmRunStream(domia, promptContext)
	for await (const sentence of splitSentences(tokens)) {
		onSentence(sentence)
		yield* ttsTextToChunks(domia, sentence, features)
	}
}

export const fullReplyChunks = async function* (
	domia: DomiaType,
	promptContext: string,
	features: CoreBusFeaturesType,
	onReply: (reply: string) => void,
): AsyncIterable<Buffer> {
	const reply = await runLLM(domia, promptContext)
	onReply(reply)
	yield* ttsTextToChunks(domia, reply, features)
}
