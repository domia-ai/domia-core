import type { DomiaType } from "@/modules/core"
import type {
	PlaybackLedgerType,
	SentencePipelineType,
	StreamingSinkFormatType,
} from "../types"
import { extractEmotionTags } from "./emotion-tags"
import {
	concatStreams,
	createAsyncQueue,
	eagerTtsSlotsFromDomia,
	pipelineDepthFromDomia,
	primeStream,
	sentenceTuningFromDomia,
	splitSentences,
} from "./sentence-buffer"
import { createPlaybackLedger } from "./spoken-position"
import { registerTurnLedger } from "./turn-scope"

export const turnLedgerFor = (
	domia: DomiaType,
	interactionId: string,
	format: StreamingSinkFormatType,
): PlaybackLedgerType => {
	const ledger = createPlaybackLedger(format, {
		wordLevelHeard: domia.audioPlaybackConfig?.wordLevelHeardEnabled ?? false,
	})
	registerTurnLedger(interactionId, ledger)
	return ledger
}

export const createSentencePipeline = (
	domia: DomiaType,
	ledger?: PlaybackLedgerType,
): SentencePipelineType => {
	const queue = createAsyncQueue<AsyncIterable<Buffer>>()
	const queueDepth = pipelineDepthFromDomia(domia)
	const eagerSlots = eagerTtsSlotsFromDomia(domia)
	const wrap = (
		sentence: string,
		audio: AsyncIterable<Buffer>,
	): AsyncIterable<Buffer> =>
		ledger
			? ledger.wrapSentence(extractEmotionTags(sentence).clean, audio)
			: audio
	return {
		sentencesOf: (tokens, startEmitted = false) =>
			splitSentences(tokens, sentenceTuningFromDomia(domia), startEmitted),
		audio: concatStreams(queue.iter()),
		waitForSpace: () => queue.waitForSpace(queueDepth),
		push: (sentence, audio, mode) =>
			queue.push(
				wrap(
					sentence,
					mode?.primed === false ? audio : primeStream(audio, eagerSlots),
				),
			),
		close: queue.close,
		isClosed: queue.isClosed,
	}
}
