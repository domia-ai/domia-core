import { audioCaptureLogger } from "@/utils"
import type {
	CaptureFormatType,
	MicTapListenerType,
	MicTapStateType,
} from "../types"

const RING_MAX_BYTES = 32000
const FRESH_MS = 1500

const taps = new Map<string, MicTapStateType>()

const stateOf = (domiaId: string): MicTapStateType => {
	let s = taps.get(domiaId)
	if (!s) {
		s = {
			listeners: new Set(),
			ring: [],
			ringBytes: 0,
			lastChunkAt: 0,
			format: null,
		}
		taps.set(domiaId, s)
	}
	return s
}

export const setMicTapFormat = (
	domiaId: string,
	format: CaptureFormatType,
): void => {
	stateOf(domiaId).format = format
}

export const publishMicChunk = (domiaId: string, chunk: Buffer): void => {
	const s = stateOf(domiaId)
	s.lastChunkAt = Date.now()
	s.ring.push({ at: s.lastChunkAt, chunk })
	s.ringBytes += chunk.length
	while (s.ringBytes > RING_MAX_BYTES && s.ring.length > 1) {
		const dropped = s.ring.shift()
		s.ringBytes -= dropped?.chunk.length ?? 0
	}
	for (const listener of s.listeners) {
		try {
			listener(chunk)
		} catch (err) {
			audioCaptureLogger.warn("mic tap listener failed", { domiaId, err })
		}
	}
}

const formatsMatch = (a: CaptureFormatType, b: CaptureFormatType): boolean =>
	a.sampleRate === b.sampleRate &&
	a.bitsPerSample === b.bitsPerSample &&
	a.channels === b.channels

export const micTapAvailable = (
	domiaId: string,
	format: CaptureFormatType,
): boolean => {
	const s = taps.get(domiaId)
	return (
		s !== undefined &&
		Date.now() - s.lastChunkAt < FRESH_MS &&
		s.format !== null &&
		formatsMatch(s.format, format)
	)
}

export const tapMicStream = (
	domiaId: string,
	listener: MicTapListenerType,
	replaySinceTs?: number,
): (() => void) => {
	const s = stateOf(domiaId)
	if (replaySinceTs !== undefined) {
		for (const entry of s.ring) {
			if (entry.at >= replaySinceTs) listener(entry.chunk)
		}
	}
	s.listeners.add(listener)
	return () => s.listeners.delete(listener)
}
