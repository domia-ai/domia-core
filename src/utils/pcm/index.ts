import { createLinearResampler } from "@/utils/ml-runtime"
import type { Pcm16ConverterType, PcmFormatType } from "./types"

const INT16_SCALE = 32768
const BITS_PER_BYTE = 8

export const int16BufferToFloat32 = (chunk: Buffer): Float32Array => {
	const samples = new Float32Array(Math.floor(chunk.length / 2))
	for (let i = 0; i < samples.length; i++) {
		samples[i] = chunk.readInt16LE(i * 2) / INT16_SCALE
	}
	return samples
}

export const float32ToInt16Buffer = (samples: Float32Array): Buffer => {
	const out = Buffer.allocUnsafe(samples.length * 2)
	for (let i = 0; i < samples.length; i++) {
		const clamped = Math.max(-1, Math.min(1, samples[i]))
		out.writeInt16LE(Math.round(clamped * (INT16_SCALE - 1)), i * 2)
	}
	return out
}

export const pcm16Rms = (pcm: Buffer): number => {
	const samples = pcm.length >> 1
	if (samples === 0) return 0
	let sum = 0
	for (let i = 0; i < samples; i++) {
		const v = pcm.readInt16LE(i << 1) / INT16_SCALE
		sum += v * v
	}
	return Math.sqrt(sum / samples)
}

export const bytesToAudioMs = (
	bytes: number,
	sampleRate: number,
	channels: number,
	bitsPerSample = 16,
): number => {
	const bytesPerSec = sampleRate * channels * (bitsPerSample / BITS_PER_BYTE)
	return Math.round((bytes / bytesPerSec) * 1000)
}

const remixFrames = (
	samples: Float32Array,
	from: number,
	to: number,
): Float32Array => {
	if (from === to) return samples
	const frames = Math.floor(samples.length / from)
	const out = new Float32Array(frames * to)
	for (let f = 0; f < frames; f++) {
		let sum = 0
		for (let c = 0; c < from; c++) sum += samples[f * from + c]
		const mixed = sum / from
		for (let c = 0; c < to; c++) out[f * to + c] = mixed
	}
	return out
}

export const createPcm16Converter = (
	source: PcmFormatType,
	target: PcmFormatType,
): Pcm16ConverterType => {
	const frameBytes = 2 * source.channels
	const resampler =
		source.sampleRate === target.sampleRate
			? null
			: createLinearResampler(source.sampleRate, target.sampleRate)
	let carry = Buffer.alloc(0)
	const convert = (pcm: Buffer, last: boolean): Buffer => {
		const joined = carry.length > 0 ? Buffer.concat([carry, pcm]) : pcm
		const usable = joined.length - (joined.length % frameBytes)
		carry = Buffer.from(joined.subarray(usable))
		const interleaved = int16BufferToFloat32(joined.subarray(0, usable))
		const mono = remixFrames(interleaved, source.channels, 1)
		const resampled = resampler
			? last
				? resampler.flush(mono)
				: resampler.resample(mono)
			: mono
		return float32ToInt16Buffer(remixFrames(resampled, 1, target.channels))
	}
	return {
		push: (chunk) => convert(chunk, false),
		flush: () => convert(Buffer.alloc(0), true),
	}
}
