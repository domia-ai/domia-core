const HARD_TERMINATORS = /([.!?])\s/
const SOFT_TERMINATORS = /([,;:])\s/
const SOFT_FLUSH_MIN_CHARS = 20
const FIRST_UNIT_MAX_WORDS = 8
const MEDIUM_FLUSH_CHARS = 60
const HARD_FLUSH_CHARS = 200

type FlushResultType = { sentence: string; remaining: string } | null

const tryHardTerminator = (buffer: string): FlushResultType => {
	const match = HARD_TERMINATORS.exec(buffer)
	if (!match || match.index === undefined) return null
	const cut = match.index + match[0].length
	return { sentence: buffer.slice(0, cut).trim(), remaining: buffer.slice(cut) }
}

const trySoftTerminator = (buffer: string): FlushResultType => {
	if (buffer.length < SOFT_FLUSH_MIN_CHARS) return null
	const match = SOFT_TERMINATORS.exec(buffer)
	if (!match || match.index === undefined) return null
	const cut = match.index + match[0].length
	return { sentence: buffer.slice(0, cut).trim(), remaining: buffer.slice(cut) }
}

const tryFirstUnitWordFlush = (buffer: string): FlushResultType => {
	const re = /\S+\s+/g
	let count = 0
	for (let match = re.exec(buffer); match !== null; match = re.exec(buffer)) {
		count++
		if (count >= FIRST_UNIT_MAX_WORDS) {
			const cut = re.lastIndex
			return {
				sentence: buffer.slice(0, cut).trim(),
				remaining: buffer.slice(cut),
			}
		}
	}
	return null
}

const tryMediumFlush = (buffer: string): FlushResultType => {
	if (buffer.length < MEDIUM_FLUSH_CHARS) return null
	const idx = buffer.lastIndexOf(" ")
	if (idx <= 0) return null
	return {
		sentence: buffer.slice(0, idx).trim(),
		remaining: buffer.slice(idx + 1),
	}
}

const tryHardFlush = (buffer: string): FlushResultType => {
	if (buffer.length < HARD_FLUSH_CHARS) return null
	const idx = buffer.lastIndexOf(" ")
	const cut = idx > 0 ? idx + 1 : buffer.length
	return { sentence: buffer.slice(0, cut).trim(), remaining: buffer.slice(cut) }
}

const nextFlush = (buffer: string, emittedAny: boolean): FlushResultType =>
	tryHardTerminator(buffer) ??
	(emittedAny ? null : trySoftTerminator(buffer)) ??
	(emittedAny ? null : tryFirstUnitWordFlush(buffer)) ??
	(emittedAny ? null : tryMediumFlush(buffer)) ??
	tryHardFlush(buffer)

export const splitSentences = async function* (
	tokens: AsyncIterable<string>,
): AsyncIterable<string> {
	let buffer = ""
	let emittedAny = false

	for await (const token of tokens) {
		buffer += token
		while (true) {
			const result = nextFlush(buffer, emittedAny)
			if (!result) break
			buffer = result.remaining
			if (result.sentence.length === 0) continue
			yield result.sentence
			emittedAny = true
		}
	}

	const tail = buffer.trim()
	if (tail.length > 0) yield tail
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
		if (sentence.length > 0) out.push(sentence)
		rest = rest.slice(cut)
	}
	const tail = rest.trim()
	if (tail.length > 0) out.push(tail)
	return out.length > 0 ? out : [trimmed]
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
