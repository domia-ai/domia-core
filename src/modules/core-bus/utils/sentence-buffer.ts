import {
	DEFAULT_SENTENCE_SOFT_FLUSH_MIN_CHARS,
	DEFAULT_SENTENCE_FIRST_UNIT_MAX_WORDS,
	DEFAULT_SENTENCE_MEDIUM_FLUSH_CHARS,
	DEFAULT_SENTENCE_HARD_FLUSH_CHARS,
	DEFAULT_SENTENCE_FIRST_FLUSH_MAX_MS,
	DEFAULT_PIPELINE_MAX_QUEUE_DEPTH,
	DEFAULT_PIPELINE_EAGER_TTS_SENTENCES,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import type {
	FlushResultType,
	SentenceFlushTuningType,
} from "../types/sentence-buffer"

const HARD_TERMINATORS = /([.!?])\s/
const SOFT_TERMINATORS = /([,;:])\s/

export const DEFAULT_SENTENCE_TUNING: SentenceFlushTuningType = {
	softFlushMinChars: DEFAULT_SENTENCE_SOFT_FLUSH_MIN_CHARS,
	firstUnitMaxWords: DEFAULT_SENTENCE_FIRST_UNIT_MAX_WORDS,
	mediumFlushChars: DEFAULT_SENTENCE_MEDIUM_FLUSH_CHARS,
	hardFlushChars: DEFAULT_SENTENCE_HARD_FLUSH_CHARS,
	firstFlushMaxMs: DEFAULT_SENTENCE_FIRST_FLUSH_MAX_MS,
}

export const pipelineDepthFromDomia = (domia: DomiaType): number =>
	domia.ttsConfig?.pipelineMaxQueueDepth ?? DEFAULT_PIPELINE_MAX_QUEUE_DEPTH

export const eagerTtsSlotsFromDomia = (domia: DomiaType): EagerSlots =>
	new EagerSlots(
		domia.ttsConfig?.pipelineEagerTtsSentences ??
			DEFAULT_PIPELINE_EAGER_TTS_SENTENCES,
	)

const tryHardTerminator = (buffer: string): FlushResultType => {
	const match = HARD_TERMINATORS.exec(buffer)
	if (!match || match.index === undefined) return null
	const cut = match.index + match[0].length
	return { sentence: buffer.slice(0, cut).trim(), remaining: buffer.slice(cut) }
}

const trySoftTerminator = (
	buffer: string,
	tuning: SentenceFlushTuningType,
): FlushResultType => {
	if (buffer.length < tuning.softFlushMinChars) return null
	const match = SOFT_TERMINATORS.exec(buffer)
	if (!match || match.index === undefined) return null
	const cut = match.index + match[0].length
	return { sentence: buffer.slice(0, cut).trim(), remaining: buffer.slice(cut) }
}

const tryFirstUnitWordFlush = (
	buffer: string,
	tuning: SentenceFlushTuningType,
): FlushResultType => {
	const re = /\S+\s+/g
	let count = 0
	for (let match = re.exec(buffer); match !== null; match = re.exec(buffer)) {
		count++
		if (count >= tuning.firstUnitMaxWords) {
			const cut = re.lastIndex
			return {
				sentence: buffer.slice(0, cut).trim(),
				remaining: buffer.slice(cut),
			}
		}
	}
	return null
}

const tryMediumFlush = (
	buffer: string,
	tuning: SentenceFlushTuningType,
): FlushResultType => {
	if (buffer.length < tuning.mediumFlushChars) return null
	const idx = buffer.lastIndexOf(" ")
	if (idx <= 0) return null
	return {
		sentence: buffer.slice(0, idx).trim(),
		remaining: buffer.slice(idx + 1),
	}
}

const tryHardFlush = (
	buffer: string,
	tuning: SentenceFlushTuningType,
): FlushResultType => {
	if (buffer.length < tuning.hardFlushChars) return null
	const idx = buffer.lastIndexOf(" ")
	const cut = idx > 0 ? idx + 1 : buffer.length
	return { sentence: buffer.slice(0, cut).trim(), remaining: buffer.slice(cut) }
}

const nextFlush = (
	buffer: string,
	emittedAny: boolean,
	tuning: SentenceFlushTuningType,
): FlushResultType =>
	tryHardTerminator(buffer) ??
	(emittedAny ? null : trySoftTerminator(buffer, tuning)) ??
	(emittedAny ? null : tryFirstUnitWordFlush(buffer, tuning)) ??
	(emittedAny ? null : tryMediumFlush(buffer, tuning)) ??
	tryHardFlush(buffer, tuning)

export const sentenceTuningFromDomia = (
	domia: DomiaType,
): SentenceFlushTuningType => {
	const tts = domia.ttsConfig
	if (!tts) return DEFAULT_SENTENCE_TUNING
	return {
		softFlushMinChars: tts.sentenceSoftFlushMinChars,
		firstUnitMaxWords: tts.sentenceFirstUnitMaxWords,
		mediumFlushChars: tts.sentenceMediumFlushChars,
		hardFlushChars: tts.sentenceHardFlushChars,
		firstFlushMaxMs: tts.sentenceFirstFlushMaxMs,
	}
}

const tryFirstFlushTimeCap = (buffer: string): FlushResultType => {
	const idx = buffer.lastIndexOf(" ")
	if (idx <= 0) return null
	return {
		sentence: buffer.slice(0, idx).trim(),
		remaining: buffer.slice(idx + 1),
	}
}

const isSpeakable = (sentence: string): boolean =>
	/[\p{L}\p{N}]/u.test(sentence)

export const splitSentences = async function* (
	tokens: AsyncIterable<string>,
	tuning: SentenceFlushTuningType = DEFAULT_SENTENCE_TUNING,
): AsyncIterable<string> {
	let buffer = ""
	let emittedAny = false
	let firstTokenAt = 0

	for await (const token of tokens) {
		if (firstTokenAt === 0) firstTokenAt = Date.now()
		buffer += token
		while (true) {
			const result = nextFlush(buffer, emittedAny, tuning)
			if (!result) break
			buffer = result.remaining
			if (!isSpeakable(result.sentence)) continue
			yield result.sentence
			emittedAny = true
		}
		if (
			!emittedAny &&
			tuning.firstFlushMaxMs > 0 &&
			Date.now() - firstTokenAt >= tuning.firstFlushMaxMs
		) {
			const capped = tryFirstFlushTimeCap(buffer)
			if (capped && isSpeakable(capped.sentence)) {
				buffer = capped.remaining
				yield capped.sentence
				emittedAny = true
			}
		}
	}

	const tail = buffer.trim()
	if (isSpeakable(tail)) yield tail
}

export const splitTextIntoSentences = (text: string): string[] => {
	const trimmed = text.trim()
	if (trimmed.length === 0) return []
	const out: string[] = []
	let rest = trimmed
	for (
		let match = HARD_TERMINATORS.exec(rest);
		match !== null && match.index !== undefined;
		match = HARD_TERMINATORS.exec(rest)
	) {
		const cut = match.index + match[0].length
		const sentence = rest.slice(0, cut).trim()
		if (isSpeakable(sentence)) out.push(sentence)
		rest = rest.slice(cut)
	}
	const tail = rest.trim()
	if (isSpeakable(tail)) out.push(tail)
	if (out.length > 0) return out
	return isSpeakable(trimmed) ? [trimmed] : []
}

export class AsyncQueue<T> {
	private buffer: T[] = []
	private waiters: ((value: T | null) => void)[] = []
	private spaceWaiters: (() => void)[] = []
	private closed = false

	push(item: T): void {
		if (this.closed) return
		const waiter = this.waiters.shift()
		if (waiter) waiter(item)
		else this.buffer.push(item)
	}

	async waitForSpace(maxDepth: number): Promise<void> {
		while (!this.closed && this.buffer.length >= maxDepth) {
			await new Promise<void>((resolve) => this.spaceWaiters.push(resolve))
		}
	}

	close(): void {
		if (this.closed) return
		this.closed = true
		for (const waiter of this.waiters) waiter(null)
		this.waiters = []
		for (const resolve of this.spaceWaiters) resolve()
		this.spaceWaiters = []
	}

	async *iter(): AsyncIterable<T> {
		while (true) {
			const next = this.buffer.shift()
			if (next !== undefined) {
				const space = this.spaceWaiters.shift()
				if (space) space()
				yield next
				continue
			}
			if (this.closed) return
			const item = await new Promise<T | null>((resolve) =>
				this.waiters.push(resolve),
			)
			if (item === null) return
			yield item
		}
	}
}

export const concatStreams = async function* <T>(
	streams: AsyncIterable<AsyncIterable<T>>,
): AsyncIterable<T> {
	for await (const stream of streams) {
		for await (const chunk of stream) yield chunk
	}
}

export class EagerSlots {
	private available: number

	constructor(size: number) {
		this.available = Math.max(0, size)
	}

	tryAcquire(): boolean {
		if (this.available <= 0) return false
		this.available--
		return true
	}

	release(): void {
		this.available++
	}
}

export const primeStream = <T>(
	src: AsyncIterable<T>,
	slots: EagerSlots,
): AsyncIterable<T> => {
	if (!slots.tryAcquire()) return src
	const queue = new AsyncQueue<T>()
	let pumpError: unknown = null
	void (async () => {
		try {
			for await (const item of src) queue.push(item)
		} catch (err) {
			pumpError = err
		} finally {
			queue.close()
			slots.release()
		}
	})()
	return (async function* (): AsyncIterable<T> {
		for await (const item of queue.iter()) yield item
		if (pumpError) throw pumpError
	})()
}
