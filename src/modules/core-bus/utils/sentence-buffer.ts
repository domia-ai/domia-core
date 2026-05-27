const HARD_TERMINATORS = /([.!?])\s/
const SOFT_TERMINATORS = /([,;:])\s/
const SOFT_FLUSH_MIN_CHARS = 20
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

export class AsyncQueue<T> {
	private buffer: T[] = []
	private waiters: ((value: T | null) => void)[] = []
	private closed = false

	push(item: T): void {
		if (this.closed) return
		const waiter = this.waiters.shift()
		if (waiter) waiter(item)
		else this.buffer.push(item)
	}

	close(): void {
		if (this.closed) return
		this.closed = true
		for (const waiter of this.waiters) waiter(null)
		this.waiters = []
	}

	async *iter(): AsyncIterable<T> {
		while (true) {
			const next = this.buffer.shift()
			if (next !== undefined) {
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
