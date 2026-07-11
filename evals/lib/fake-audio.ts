import type { VadWindowType } from "@/modules/audio-capture"

import { sleep } from "./http"
import type {
	FakeAudioScriptType,
	FakeAudioSegmentKindType,
	FakeAudioTickType,
} from "../types"

const DEFAULT_SAMPLE_RATE = 16000
const DEFAULT_CHUNK_MS = 30
const SPEECH_PEAK = 18000
const SPEECH_F0_HZ = 120
const SPEECH_HARMONIC_COUNT = 24
const SPEECH_VIBRATO_HZ = 5
const FORMANTS_HZ = [500, 1500]
const FORMANT_BANDWIDTH_HZ = 350
const HARMONIC_FLOOR = 0.1

const harmonicGains = Array.from(
	{ length: SPEECH_HARMONIC_COUNT },
	(_, index) => {
		const freq = SPEECH_F0_HZ * (index + 1)
		return FORMANTS_HZ.reduce(
			(gain, formant) =>
				gain +
				Math.exp(-((freq - formant) ** 2) / (2 * FORMANT_BANDWIDTH_HZ ** 2)),
			HARMONIC_FLOOR,
		)
	},
)

const gainTotal = harmonicGains.reduce((sum, gain) => sum + gain, 0)

const speechSampleAt = (sampleIndex: number, sampleRate: number): number => {
	const t = sampleIndex / sampleRate
	const harmonicSum = harmonicGains.reduce(
		(sum, gain, index) =>
			sum + gain * Math.sin(2 * Math.PI * SPEECH_F0_HZ * (index + 1) * t),
		0,
	)
	const vibrato = 0.55 + 0.45 * Math.sin(2 * Math.PI * SPEECH_VIBRATO_HZ * t)
	return Math.round((SPEECH_PEAK * vibrato * harmonicSum) / gainTotal)
}

export const fabricateSegmentPcm = (
	kind: FakeAudioSegmentKindType,
	ms: number,
	sampleRate = DEFAULT_SAMPLE_RATE,
	sampleOffset = 0,
): Buffer => {
	const sampleCount = Math.round((ms / 1000) * sampleRate)
	const buffer = Buffer.alloc(sampleCount * 2)
	if (kind === "silence") return buffer
	for (let i = 0; i < sampleCount; i++) {
		buffer.writeInt16LE(speechSampleAt(sampleOffset + i, sampleRate), i * 2)
	}
	return buffer
}

export const fabricateTimelinePcm = (script: FakeAudioScriptType): Buffer => {
	const sampleRate = script.sampleRate ?? DEFAULT_SAMPLE_RATE
	let sampleOffset = 0
	const parts = script.segments.map((segment) => {
		const part = fabricateSegmentPcm(
			segment.kind,
			segment.ms,
			sampleRate,
			sampleOffset,
		)
		sampleOffset += part.length / 2
		return part
	})
	return Buffer.concat(parts)
}

export const feedVadTimeline = async (
	vad: VadWindowType,
	script: FakeAudioScriptType,
	onTick?: (tick: FakeAudioTickType) => void,
): Promise<void> => {
	const sampleRate = script.sampleRate ?? DEFAULT_SAMPLE_RATE
	const chunkMs = script.chunkMs ?? DEFAULT_CHUNK_MS
	const speedFactor = script.speedFactor ?? 1
	let elapsedMs = 0
	let sampleOffset = 0
	for (const segment of script.segments) {
		let remainingMs = segment.ms
		while (remainingMs > 0) {
			const stepMs = Math.min(chunkMs, remainingMs)
			const chunk = fabricateSegmentPcm(
				segment.kind,
				stepMs,
				sampleRate,
				sampleOffset,
			)
			vad.feed(chunk)
			sampleOffset += chunk.length / 2
			elapsedMs += stepMs
			remainingMs -= stepMs
			onTick?.({ elapsedMs, kind: segment.kind })
			await sleep(stepMs / speedFactor)
		}
	}
}
