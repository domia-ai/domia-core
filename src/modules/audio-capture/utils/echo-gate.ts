import { DEFAULT_PCM_SAMPLE_RATE } from "@/db"
import { pcm16Rms, int16BufferToFloat32, downmixToMonoPcm16 } from "@/utils"
import type {
	EchoGateConfigType,
	EchoGateType,
	EchoGateVerdictType,
	PlaybackReferenceType,
} from "../types"

const REFERENCE_RATE = DEFAULT_PCM_SAMPLE_RATE
const MIN_LAG_MS = 20
const COARSE_LAG_STEP_MS = 2

const references = new Map<string, PlaybackReferenceType>()
const liveSpeechAt = new Map<string, number>()

const referenceOf = (key: string, seconds: number): PlaybackReferenceType => {
	const ringSamples = Math.max(1, Math.round(REFERENCE_RATE * seconds))
	const ref = references.get(key)
	if (ref?.ring.length === ringSamples) return ref
	const fresh: PlaybackReferenceType = {
		ring: new Float32Array(ringSamples),
		writePos: 0,
		totalWritten: 0,
		lastSampleAt: ref?.lastSampleAt ?? 0,
	}
	references.set(key, fresh)
	return fresh
}

const resampleToReference = (
	samples: Float32Array,
	fromRate: number,
): Float32Array => {
	if (fromRate === REFERENCE_RATE) return samples
	const ratio = fromRate / REFERENCE_RATE
	const outLen = Math.floor(samples.length / ratio)
	const out = new Float32Array(outLen)
	for (let i = 0; i < outLen; i++) {
		const pos = i * ratio
		const i0 = Math.floor(pos)
		const i1 = Math.min(samples.length - 1, i0 + 1)
		const frac = pos - i0
		out[i] = samples[i0] * (1 - frac) + samples[i1] * frac
	}
	return out
}

export const notePlaybackReference = (
	key: string,
	pcm: Buffer,
	sampleRate: number,
	channels: number,
	seconds: number,
): void => {
	const mono = downmixToMonoPcm16(pcm, channels)
	const samples = resampleToReference(int16BufferToFloat32(mono), sampleRate)
	const ref = referenceOf(key, seconds)
	const ringSamples = ref.ring.length
	for (const sample of samples) {
		ref.ring[ref.writePos] = sample
		ref.writePos = (ref.writePos + 1) % ringSamples
	}
	ref.totalWritten += samples.length
	ref.lastSampleAt = Date.now()
}

export const clearPlaybackReference = (key: string): void => {
	references.delete(key)
	liveSpeechAt.delete(key)
}

export const hasRecentPlaybackReference = (
	key: string,
	withinMs: number,
): boolean => {
	const ref = references.get(key)
	return ref !== undefined && Date.now() - ref.lastSampleAt <= withinMs
}

const readReference = (
	ref: PlaybackReferenceType,
	endOffsetFromNewest: number,
	length: number,
): Float32Array | null => {
	const ringSamples = ref.ring.length
	const available = Math.min(ref.totalWritten, ringSamples)
	const endIndexFromOldest = available - endOffsetFromNewest
	const startIndexFromOldest = endIndexFromOldest - length
	if (startIndexFromOldest < 0 || endIndexFromOldest > available) return null
	const oldestPos = (ref.writePos - available + ringSamples) % ringSamples
	const out = new Float32Array(length)
	for (let i = 0; i < length; i++) {
		out[i] = ref.ring[(oldestPos + startIndexFromOldest + i) % ringSamples]
	}
	return out
}

const normalizedCorrelation = (a: Float32Array, b: Float32Array): number => {
	let dot = 0
	let ea = 0
	let eb = 0
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i]
		ea += a[i] * a[i]
		eb += b[i] * b[i]
	}
	if (ea === 0 || eb === 0) return 0
	return dot / Math.sqrt(ea * eb)
}

const correlationAtOffset = (
	mic: Float32Array,
	ref: PlaybackReferenceType,
	endOffsetSamples: number,
): number | null => {
	const segment = readReference(ref, endOffsetSamples, mic.length)
	return segment ? Math.abs(normalizedCorrelation(mic, segment)) : null
}

export const explainedByReference = (
	mic: Float32Array,
	ref: PlaybackReferenceType,
	micEndAt: number,
	maxDelayMs: number,
): { residual: number; lagMs: number } | null => {
	const newestAgeMs = micEndAt - ref.lastSampleAt
	const samplesPerMs = REFERENCE_RATE / 1000
	let best = 0
	let bestOffset: number | null = null
	for (
		let lagMs = MIN_LAG_MS;
		lagMs <= maxDelayMs;
		lagMs += COARSE_LAG_STEP_MS
	) {
		const offsetMs = lagMs - newestAgeMs
		if (offsetMs < 0) continue
		const endOffset = Math.round(offsetMs * samplesPerMs)
		const rho = correlationAtOffset(mic, ref, endOffset)
		if (rho === null) break
		if (rho > best) {
			best = rho
			bestOffset = endOffset
		}
	}
	if (bestOffset === null) return null
	const refineSpan = Math.round(COARSE_LAG_STEP_MS * samplesPerMs)
	for (
		let offset = Math.max(0, bestOffset - refineSpan);
		offset <= bestOffset + refineSpan;
		offset++
	) {
		const rho = correlationAtOffset(mic, ref, offset)
		if (rho !== null && rho > best) {
			best = rho
			bestOffset = offset
		}
	}
	return {
		residual: 1 - best * best,
		lagMs: Math.round(bestOffset / samplesPerMs + newestAgeMs),
	}
}

export const createEchoGate = (
	key: string,
	config: EchoGateConfigType,
): EchoGateType => {
	const frameBytes =
		Math.floor((REFERENCE_RATE * config.echoResidualWindowMs) / 1000) * 2
	let pending: Buffer = Buffer.alloc(0)
	let consecutive = 0
	let last: EchoGateVerdictType = {
		accept: false,
		frames: 0,
		rms: 0,
		residual: null,
		lagMs: null,
	}

	const judgeFrame = (frame: Buffer): void => {
		const rms = pcm16Rms(frame)
		if (rms < config.echoResidualMinRms) {
			consecutive = 0
			last = { accept: false, frames: 0, rms, residual: null, lagMs: null }
			return
		}
		const ref = references.get(key)
		const now = Date.now()
		const explained =
			ref &&
			now - ref.lastSampleAt <=
				config.echoResidualMaxDelayMs + config.echoResidualWindowMs
				? explainedByReference(
						int16BufferToFloat32(frame),
						ref,
						now,
						config.echoResidualMaxDelayMs,
					)
				: null
		const speech =
			explained === null || explained.residual >= config.echoResidualMinRatio
		consecutive = speech ? consecutive + 1 : 0
		const accept = consecutive >= config.echoResidualMinFrames
		if (accept) liveSpeechAt.set(key, now)
		last = {
			accept,
			frames: consecutive,
			rms,
			residual: explained?.residual ?? null,
			lagMs: explained?.lagMs ?? null,
		}
	}

	return {
		observe: (pcm16k) => {
			pending = pending.length === 0 ? pcm16k : Buffer.concat([pending, pcm16k])
			while (pending.length >= frameBytes) {
				judgeFrame(pending.subarray(0, frameBytes))
				pending = pending.subarray(frameBytes)
			}
			return last
		},
		reset: () => {
			pending = Buffer.alloc(0)
			consecutive = 0
			last = { accept: false, frames: 0, rms: 0, residual: null, lagMs: null }
		},
	}
}

export const liveSpeechSeenRecently = (
	key: string,
	withinMs: number,
): boolean => {
	const at = liveSpeechAt.get(key)
	return at !== undefined && Date.now() - at <= withinMs
}
