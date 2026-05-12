const TERMINATORS = /([.!?])\s/
const HARD_FLUSH_CHARS = 200

export const splitSentences = async function* (
	tokens: AsyncIterable<string>,
): AsyncIterable<string> {
	let buffer = ""
	for await (const token of tokens) {
		buffer += token
		while (true) {
			const match = TERMINATORS.exec(buffer)
			if (match && match.index !== undefined) {
				const cut = match.index + match[0].length
				const sentence = buffer.slice(0, cut).trim()
				if (sentence.length > 0) yield sentence
				buffer = buffer.slice(cut)
				continue
			}
			if (buffer.length >= HARD_FLUSH_CHARS) {
				const idx = buffer.lastIndexOf(" ")
				const cut = idx > 0 ? idx + 1 : buffer.length
				const sentence = buffer.slice(0, cut).trim()
				if (sentence.length > 0) yield sentence
				buffer = buffer.slice(cut)
				continue
			}
			break
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
		const w = this.waiters.shift()
		if (w) w(item)
		else this.buffer.push(item)
	}

	close(): void {
		if (this.closed) return
		this.closed = true
		for (const w of this.waiters) w(null)
		this.waiters = []
	}

	async *iter(): AsyncIterable<T> {
		while (true) {
			if (this.buffer.length > 0) {
				const next = this.buffer.shift()
				if (next === undefined) return
				yield next
				continue
			}
			if (this.closed) return
			const item = await new Promise<T | null>((r) => this.waiters.push(r))
			if (item === null) return
			yield item
		}
	}
}

export const concatStreams = async function* <T>(
	streams: AsyncIterable<AsyncIterable<T>>,
): AsyncIterable<T> {
	for await (const stream of streams) {
		for await (const chunk of stream) {
			yield chunk
		}
	}
}
