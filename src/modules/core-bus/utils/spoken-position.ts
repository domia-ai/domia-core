import type {
	LedgerAnchorType,
	PlaybackLedgerType,
	SinkPositionFidelityType,
	StreamingSinkFormatType,
	SpokenPositionOptsType,
} from "../types"

const BYTES_PER_SAMPLE = 2
const INT16_FULL_SCALE = 32768

const bytesToMs = (bytes: number, format: StreamingSinkFormatType): number =>
	(bytes / (format.sampleRate * format.channels * BYTES_PER_SAMPLE)) * 1000

export const lastLoudSampleOffset = (
	chunk: Buffer,
	amplitude: number,
): number => {
	const threshold = amplitude * INT16_FULL_SCALE
	for (let offset = chunk.length - 2; offset >= 0; offset -= 2) {
		if (Math.abs(chunk.readInt16LE(offset)) >= threshold) return offset + 2
	}
	return 0
}

export const truncateAtWordBoundary = (text: string, chars: number): string => {
	if (chars <= 0) return ""
	if (chars >= text.length) return text
	if (/\s/.test(text[chars])) return text.slice(0, chars).trimEnd()
	const lastSpace = text.lastIndexOf(" ", chars)
	return lastSpace > 0 ? text.slice(0, lastSpace) : ""
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

export const heardPrefixOfAnchors = (
	anchors: LedgerAnchorType[],
	positionMs: number,
	format: StreamingSinkFormatType,
): string => {
	const heard: string[] = []
	for (const anchor of anchors) {
		const startMs = bytesToMs(anchor.startByte, format)
		const speechEndMs = bytesToMs(anchor.speechEndByte, format)
		if (speechEndMs <= positionMs) {
			heard.push(anchor.text)
			continue
		}
		if (startMs >= positionMs) break
		const fraction = (positionMs - startMs) / Math.max(1, speechEndMs - startMs)
		heard.push(
			truncateAtWordBoundary(
				anchor.text,
				Math.floor(anchor.text.length * fraction),
			),
		)
		break
	}
	return heard.filter(Boolean).join(" ")
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
				.filter((a) => bytesToMs(a.speechEndByte, format) <= posMs)
				.map((a) => a.text)
				.join(" ")
		}
		return heardPrefixOfAnchors(anchors, posMs, format)
	}

	return {
		format,
		totalBytes: () => totalBytes,
		anchors: () => anchors,
		wordLevelHeard: opts.wordLevelHeard,
		markFirstChunk: () => {
			firstChunkAt ??= Date.now()
		},
		addBytes: (n) => {
			totalBytes += n
		},
		wrapSentence: async function* (text, pcm) {
			const startByte = totalBytes
			let speechEndByte = startByte
			for await (const chunk of pcm) {
				if (opts.silenceTrim) {
					const loud = lastLoudSampleOffset(chunk, opts.silenceRms)
					if (loud > 0) speechEndByte = totalBytes + loud
				}
				totalBytes += chunk.length
				yield chunk
			}
			if (totalBytes > startByte) {
				anchors.push({
					text,
					startByte,
					endByte: totalBytes,
					speechEndByte:
						opts.silenceTrim && speechEndByte > startByte
							? speechEndByte
							: totalBytes,
				})
			}
		},
		pause: () => {
			pausedAt ??= Date.now()
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
