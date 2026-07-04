import { tmpdir } from "os"
import { join } from "path"
import { createWriteStream } from "fs"
import { writeFile, readFile, open, unlink } from "fs/promises"

import { generateUuid } from "@/utils/db"
import type { WavStreamWriterType } from "./types"

const WAV_HEADER_BYTES = 44
const DEFAULT_EDGE_FADE_MS = 6
const DEFAULT_RMS_TARGET_DBFS = -20
const RMS_MAX_GAIN = 4
const INT16_PEAK = 32767

export const normalizeRmsToDbfs = (
	pcm: Buffer,
	targetDbfs: number = DEFAULT_RMS_TARGET_DBFS,
): Buffer => {
	const samples = Math.floor(pcm.length / 2)
	if (samples === 0) return pcm
	let sumSq = 0
	for (let i = 0; i < samples; i++) {
		const s = pcm.readInt16LE(i * 2)
		sumSq += s * s
	}
	const rms = Math.sqrt(sumSq / samples)
	if (rms < 1) return pcm
	const targetRms = INT16_PEAK * Math.pow(10, targetDbfs / 20)
	const gain = Math.min(targetRms / rms, RMS_MAX_GAIN)
	if (gain <= 1.01) return pcm
	const out = Buffer.from(pcm)
	for (let i = 0; i < samples; i++) {
		const scaled = Math.round(out.readInt16LE(i * 2) * gain)
		out.writeInt16LE(Math.max(-INT16_PEAK, Math.min(INT16_PEAK, scaled)), i * 2)
	}
	return out
}

export const applyEdgeFade = (
	pcm: Buffer,
	sampleRate: number,
	fadeMs: number = DEFAULT_EDGE_FADE_MS,
): Buffer => {
	const totalSamples = Math.floor(pcm.length / 2)
	const fadeSamples = Math.min(
		Math.floor((fadeMs * sampleRate) / 1000),
		Math.floor(totalSamples / 2),
	)
	if (fadeSamples <= 0) return pcm
	const out = Buffer.from(pcm)
	for (let i = 0; i < fadeSamples; i++) {
		const gain = (i + 1) / fadeSamples
		const head = out.readInt16LE(i * 2)
		out.writeInt16LE(Math.round(head * gain), i * 2)
		const tailIdx = (totalSamples - 1 - i) * 2
		const tail = out.readInt16LE(tailIdx)
		out.writeInt16LE(Math.round(tail * gain), tailIdx)
	}
	return out
}

const tempPath = (interactionId: string, tag: string): string =>
	join(tmpdir(), `domia-${tag}-${interactionId || generateUuid()}.wav`)

const buildWavHeader = (
	dataSize: number,
	sampleRate: number,
	channels: number,
	bitsPerSample: number,
): Buffer => {
	const byteRate = (sampleRate * channels * bitsPerSample) / 8
	const blockAlign = (channels * bitsPerSample) / 8
	const buf = Buffer.alloc(WAV_HEADER_BYTES)
	buf.write("RIFF", 0)
	buf.writeUInt32LE(36 + dataSize, 4)
	buf.write("WAVE", 8)
	buf.write("fmt ", 12)
	buf.writeUInt32LE(16, 16)
	buf.writeUInt16LE(1, 20)
	buf.writeUInt16LE(channels, 22)
	buf.writeUInt32LE(sampleRate, 24)
	buf.writeUInt32LE(byteRate, 28)
	buf.writeUInt16LE(blockAlign, 32)
	buf.writeUInt16LE(bitsPerSample, 34)
	buf.write("data", 36)
	buf.writeUInt32LE(dataSize, 40)
	return buf
}

const STREAMING_DATA_SIZE = 0xffffffff - 36

export const buildStreamingWavHeader = (
	sampleRate: number,
	channels: number,
	bitsPerSample: number,
): Buffer =>
	buildWavHeader(STREAMING_DATA_SIZE, sampleRate, channels, bitsPerSample)

export const wrapPcmToWav = (
	pcm: Buffer,
	sampleRate: number,
	channels: number,
	bitsPerSample: number,
): Buffer =>
	Buffer.concat([
		buildWavHeader(pcm.length, sampleRate, channels, bitsPerSample),
		pcm,
	])

export const createWavStreamWriter = (
	interactionId: string,
	sampleRate: number,
	channels: number,
	bitsPerSample: number,
	tag = "audio",
): WavStreamWriterType => {
	const path = tempPath(interactionId, tag)
	const stream = createWriteStream(path)
	let streamError: Error | null = null
	stream.on("error", (err: Error) => {
		streamError = err
	})
	stream.write(buildWavHeader(0, sampleRate, channels, bitsPerSample))
	let dataSize = 0
	let closed = false
	const closeStream = (): Promise<void> =>
		new Promise((resolve, reject) => {
			if (streamError) {
				reject(streamError)
				return
			}
			stream.once("error", reject)
			stream.end(() => resolve())
		})
	return {
		filePath: path,
		write: (chunk) => {
			if (closed || streamError) return
			dataSize += chunk.length
			stream.write(chunk)
		},
		finalize: async () => {
			if (closed) return path
			closed = true
			try {
				await closeStream()
				const patch = Buffer.alloc(4)
				const handle = await open(path, "r+")
				try {
					patch.writeUInt32LE(36 + dataSize, 0)
					await handle.write(patch, 0, 4, 4)
					patch.writeUInt32LE(dataSize, 0)
					await handle.write(patch, 0, 4, 40)
				} finally {
					await handle.close()
				}
				return path
			} catch (err) {
				await unlink(path).catch(() => undefined)
				throw err
			}
		},
		abort: async () => {
			if (closed) return
			closed = true
			await closeStream().catch(() => undefined)
			await unlink(path).catch(() => undefined)
		},
	}
}

const findDataOffset = (buf: Buffer): number => {
	if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF") return 0
	let offset = 12
	while (offset + 8 <= buf.length) {
		const id = buf.toString("ascii", offset, offset + 4)
		const size = buf.readUInt32LE(offset + 4)
		if (id === "data") return offset + 8
		offset += 8 + size + (size % 2)
	}
	return WAV_HEADER_BYTES
}

export const getWavDurationMs = async (
	filePath: string,
): Promise<number | null> => {
	try {
		const buf = await readFile(filePath)
		if (buf.length < WAV_HEADER_BYTES || buf.toString("ascii", 0, 4) !== "RIFF")
			return null
		const channels = buf.readUInt16LE(22)
		const sampleRate = buf.readUInt32LE(24)
		const bitsPerSample = buf.readUInt16LE(34)
		const bytesPerSample = (channels * bitsPerSample) / 8
		if (bytesPerSample <= 0 || sampleRate <= 0) return null
		const dataBytes = buf.length - findDataOffset(buf)
		if (dataBytes <= 0) return null
		return Math.round((dataBytes / (sampleRate * bytesPerSample)) * 1000)
	} catch {
		return null
	}
}

export const writeWavToTemp = async (
	bytes: Uint8Array,
	interactionId: string,
	tag = "audio",
): Promise<string> => {
	const path = tempPath(interactionId, tag)
	await writeFile(path, Buffer.from(bytes))
	return path
}

export const wavFileToPcmChunks = async function* (
	filePath: string,
	chunkBytes = 3200,
): AsyncIterable<Buffer> {
	const buf = await readFile(filePath)
	const pcm = buf.subarray(findDataOffset(buf))
	for (let i = 0; i < pcm.length; i += chunkBytes) {
		yield pcm.subarray(i, i + chunkBytes)
	}
}

export const pcmChunksToWavFile = async (
	chunks: AsyncIterable<Buffer>,
	interactionId: string | (() => string),
	sampleRate = 16000,
	channels = 1,
): Promise<string> => {
	const parts: Buffer[] = []
	for await (const chunk of chunks) parts.push(chunk)
	const wav = wrapPcmToWav(Buffer.concat(parts), sampleRate, channels, 16)
	const resolvedId =
		typeof interactionId === "function" ? interactionId() : interactionId
	const path = tempPath(resolvedId, "stt-upload")
	await writeFile(path, wav)
	return path
}
