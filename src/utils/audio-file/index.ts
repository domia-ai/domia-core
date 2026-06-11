import { tmpdir } from "os"
import { join } from "path"
import { writeFile, readFile } from "fs/promises"

import { generateUuid } from "@/utils/db"

const WAV_HEADER_BYTES = 44

const tempPath = (interactionId: string, tag: string): string =>
	join(tmpdir(), `domia-${tag}-${interactionId || generateUuid()}.wav`)

export const wrapPcmToWav = (
	pcm: Buffer,
	sampleRate: number,
	channels: number,
	bitsPerSample: number,
): Buffer => {
	const byteRate = (sampleRate * channels * bitsPerSample) / 8
	const blockAlign = (channels * bitsPerSample) / 8
	const dataSize = pcm.length
	const buf = Buffer.alloc(WAV_HEADER_BYTES + dataSize)
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
	pcm.copy(buf, WAV_HEADER_BYTES)
	return buf
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
