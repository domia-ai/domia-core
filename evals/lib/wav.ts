import { readFileSync } from "fs"
import type { ParsedWavType } from "../types"

export const parseWavPcm = (wavPath: string): ParsedWavType => {
	const buf = readFileSync(wavPath)
	const channels = buf.readUInt16LE(22)
	const sampleRate = buf.readUInt32LE(24)
	let offset = 12
	while (offset + 8 <= buf.length) {
		const id = buf.toString("ascii", offset, offset + 4)
		const size = buf.readUInt32LE(offset + 4)
		if (id === "data") {
			return {
				pcm: buf.subarray(offset + 8, offset + 8 + size),
				sampleRate,
				channels,
			}
		}
		offset += 8 + size + (size % 2)
	}
	throw new Error("no data chunk")
}
