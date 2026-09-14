import type { FlacEncoderType, FlacStreamFormatType } from "./types"

const BITS_PER_SAMPLE = 16
export const FLAC_BLOCK_SIZE = 4096
const STREAMINFO_BLOCK_TYPE = 0
const STREAMINFO_LENGTH = 34
const LAST_METADATA_BLOCK = 0x80
const FRAME_SYNC = 0xfff8
const BLOCK_SIZE_16BIT_CODE = 0x07
const SAMPLE_SIZE_16BIT_CODE = 0x04
const VERBATIM_SUBFRAME = 0x02
const SAMPLE_RATE_FROM_STREAMINFO = 0x00
const SAMPLE_RATE_CODES: Record<number, number> = {
	88200: 0x01,
	176400: 0x02,
	192000: 0x03,
	8000: 0x04,
	16000: 0x05,
	22050: 0x06,
	24000: 0x07,
	32000: 0x08,
	44100: 0x09,
	48000: 0x0a,
	96000: 0x0b,
}

const crc8Table = Uint8Array.from({ length: 256 }, (_, n) => {
	let crc = n
	for (let bit = 0; bit < 8; bit++)
		crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff
	return crc
})

const crc16Table = Uint16Array.from({ length: 256 }, (_, n) => {
	let crc = n << 8
	for (let bit = 0; bit < 8; bit++)
		crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff
	return crc
})

const crc8 = (bytes: Buffer): number => {
	let crc = 0
	for (const byte of bytes) crc = crc8Table[crc ^ byte]
	return crc
}

const crc16 = (bytes: Buffer): number => {
	let crc = 0
	for (const byte of bytes)
		crc = ((crc << 8) & 0xffff) ^ crc16Table[(crc >> 8) ^ byte]
	return crc
}

const utf8FrameNumber = (value: number): number[] => {
	if (value < 0x80) return [value]
	const limits = [0x800, 0x10000, 0x200000, 0x4000000, 0x80000000]
	const extra = limits.findIndex((limit) => value < limit) + 1
	const bytes: number[] = []
	let rest = value
	for (let i = 0; i < extra; i++) {
		bytes.unshift(0x80 | (rest & 0x3f))
		rest = Math.floor(rest / 64)
	}
	const lead = (0xff << (7 - extra)) & 0xff
	bytes.unshift(lead | rest)
	return bytes
}

export const createFlacEncoder = (
	format: FlacStreamFormatType,
): FlacEncoderType => {
	const frameBytes = 2 * format.channels
	let carry = Buffer.alloc(0)
	let frameNumber = 0

	const encodeFrame = (pcm: Buffer): Buffer => {
		const samples = pcm.length / frameBytes
		const head = Buffer.from([
			FRAME_SYNC >> 8,
			FRAME_SYNC & 0xff,
			(BLOCK_SIZE_16BIT_CODE << 4) |
				(SAMPLE_RATE_CODES[format.sampleRate] ?? SAMPLE_RATE_FROM_STREAMINFO),
			((format.channels - 1) << 4) | (SAMPLE_SIZE_16BIT_CODE << 1),
			...utf8FrameNumber(frameNumber),
			(samples - 1) >> 8,
			(samples - 1) & 0xff,
		])
		frameNumber++
		const body = Buffer.alloc(format.channels * (1 + samples * 2))
		let offset = 0
		for (let channel = 0; channel < format.channels; channel++) {
			body[offset++] = VERBATIM_SUBFRAME
			for (let i = 0; i < samples; i++) {
				body.writeInt16BE(
					pcm.readInt16LE((i * format.channels + channel) * 2),
					offset,
				)
				offset += 2
			}
		}
		const unsealed = Buffer.concat([head, Buffer.from([crc8(head)]), body])
		const footer = Buffer.alloc(2)
		footer.writeUInt16BE(crc16(unsealed), 0)
		return Buffer.concat([unsealed, footer])
	}

	const drain = (final: boolean): Buffer => {
		const blockBytes = format.blockSize * frameBytes
		const frames: Buffer[] = []
		let offset = 0
		while (carry.length - offset >= blockBytes) {
			frames.push(encodeFrame(carry.subarray(offset, offset + blockBytes)))
			offset += blockBytes
		}
		const usable = carry.length - ((carry.length - offset) % frameBytes)
		if (final && usable > offset) {
			frames.push(encodeFrame(carry.subarray(offset, usable)))
			offset = usable
		}
		carry = Buffer.from(carry.subarray(offset))
		return Buffer.concat(frames)
	}

	return {
		header: (totalSamples = 0) => {
			const info = Buffer.alloc(4 + 4 + STREAMINFO_LENGTH)
			info.write("fLaC", 0, "ascii")
			info[4] = LAST_METADATA_BLOCK | STREAMINFO_BLOCK_TYPE
			info.writeUIntBE(STREAMINFO_LENGTH, 5, 3)
			info.writeUInt16BE(format.blockSize, 8)
			info.writeUInt16BE(format.blockSize, 10)
			const rate = format.sampleRate
			info[18] = (rate >> 12) & 0xff
			info[19] = (rate >> 4) & 0xff
			info[20] =
				((rate & 0x0f) << 4) |
				((format.channels - 1) << 1) |
				((BITS_PER_SAMPLE - 1) >> 4)
			const high = Math.floor(totalSamples / 2 ** 32) & 0x0f
			info[21] = (((BITS_PER_SAMPLE - 1) & 0x0f) << 4) | high
			info.writeUInt32BE(totalSamples >>> 0, 22)
			return info
		},
		push: (pcm16) => {
			carry = Buffer.concat([carry, pcm16])
			return drain(false)
		},
		flush: () => drain(true),
	}
}
