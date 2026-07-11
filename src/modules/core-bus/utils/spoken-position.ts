import type {
	LedgerAnchorType,
	PlaybackLedgerType,
	SinkPositionFidelityType,
	StreamingSinkFormatType,
	SpokenPositionOptsType,
} from "../types"

const BYTES_PER_SAMPLE = 2

const bytesToMs = (bytes: number, format: StreamingSinkFormatType): number =>
	(bytes / (format.sampleRate * format.channels * BYTES_PER_SAMPLE)) * 1000

export const truncateAtWordBoundary = (text: string, chars: number): string => {
	if (chars <= 0) return ""
	if (chars >= text.length) return text
	const slice = text.slice(0, chars)
	const lastSpace = slice.lastIndexOf(" ")
	return lastSpace > 0 ? slice.slice(0, lastSpace) : slice
}

export const heardTextFromUniformRate = (
	reply: string,
	positionMs: number,
	totalMs: number,
): string => {
	if (totalMs <= 0 || positionMs >= totalMs) return reply
	if (positionMs <= 0) return ""
	return truncateAtWordBoundary(
		reply,
		Math.floor(reply.length * (positionMs / totalMs)),
	)
}

export const createPlaybackLedger = (
	format: StreamingSinkFormatType,
	opts: SpokenPositionOptsType,
): PlaybackLedgerType => {
	const anchors: LedgerAnchorType[] = []
	let totalBytes = 0
	let firstChunkAt: number | null = null
	let pausedAt: number | null = null
	let pausedTotalMs = 0
	let gateWaiters: (() => void)[] = []

	const releaseGate = (): void => {
		const waiters = gateWaiters
		gateWaiters = []
		for (const w of waiters) w()
	}

	const positionMs = (): number | undefined => {
		if (firstChunkAt === null) return undefined
		const wallMs = (pausedAt ?? Date.now()) - firstChunkAt - pausedTotalMs
		return Math.max(0, Math.min(bytesToMs(totalBytes, format), wallMs))
	}

	const heardTextAt = (
		posMs: number,
		fidelity: SinkPositionFidelityType,
	): string => {
		if (fidelity === "none" || anchors.length === 0) return ""
		if (fidelity === "sentence") {
			return anchors
				.filter((a) => bytesToMs(a.endByte, format) <= posMs)
				.map((a) => a.text)
				.join(" ")
		}
		const heard: string[] = []
		for (const a of anchors) {
			const startMs = bytesToMs(a.startByte, format)
			const endMs = bytesToMs(a.endByte, format)
			if (endMs <= posMs) {
				heard.push(a.text)
				continue
			}
			if (startMs >= posMs) break
			const fraction = (posMs - startMs) / Math.max(1, endMs - startMs)
			heard.push(
				truncateAtWordBoundary(a.text, Math.floor(a.text.length * fraction)),
			)
			break
		}
		return heard.filter(Boolean).join(" ")
	}

	return {
		format,
		totalBytes: () => totalBytes,
		anchors: () => anchors,
		wordLevelHeard: opts.wordLevelHeard,
		markFirstChunk: () => {
			if (firstChunkAt === null) firstChunkAt = Date.now()
		},
		addBytes: (n) => {
			totalBytes += n
		},
		wrapSentence: async function* (text, pcm) {
			const startByte = totalBytes
			for await (const chunk of pcm) {
				totalBytes += chunk.length
				yield chunk
			}
			if (totalBytes > startByte) {
				anchors.push({ text, startByte, endByte: totalBytes })
			}
		},
		pause: () => {
			if (pausedAt === null) pausedAt = Date.now()
		},
		resume: () => {
			if (pausedAt !== null) {
				pausedTotalMs += Date.now() - pausedAt
				pausedAt = null
			}
			releaseGate()
		},
		isPaused: () => pausedAt !== null,
		waitResume: () =>
			new Promise<void>((resolve) => {
				if (pausedAt === null) resolve()
				else gateWaiters.push(resolve)
			}),
		releaseGate,
		positionMs,
		heardTextAt,
	}
}
