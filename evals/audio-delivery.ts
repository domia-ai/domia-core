import { createFlacEncoder, FLAC_BLOCK_SIZE } from "@/utils/flac"
import { createPcm16Converter } from "@/utils/pcm"
import { readWavPcm, wrapPcmToWav } from "@/utils/audio-file"
import { withAudioFormat } from "@/modules/core-bus/utils/audio"
import {
	mediaPlayerFormatsOf,
	playbackFormatOf,
} from "@/modules/satellite-protocols/esphome/utils"

import { makeChecker } from "./lib"

const checker = makeChecker()

const tone = (
	sampleRate: number,
	seconds: number,
	channels: number,
	hz: number,
): Buffer => {
	const frames = Math.round(sampleRate * seconds)
	const pcm = Buffer.alloc(frames * channels * 2)
	for (let f = 0; f < frames; f++)
		for (let c = 0; c < channels; c++)
			pcm.writeInt16LE(
				Math.round(
					(c === 0 ? 11000 : -7000) *
						Math.sin((2 * Math.PI * hz * f) / sampleRate),
				),
				(f * channels + c) * 2,
			)
	return pcm
}

const crc8 = (bytes: Buffer): number => {
	let crc = 0
	for (const byte of bytes) {
		crc ^= byte
		for (let bit = 0; bit < 8; bit++)
			crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff
	}
	return crc
}

const crc16 = (bytes: Buffer): number => {
	let crc = 0
	for (const byte of bytes) {
		crc ^= byte << 8
		for (let bit = 0; bit < 8; bit++)
			crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff
	}
	return crc
}

const utf8Length = (lead: number): number => {
	if ((lead & 0x80) === 0) return 1
	let length = 0
	while (lead & (0x80 >> length)) length++
	return length
}

const decodeVerbatimFlac = (flac: Buffer) => {
	const info = {
		magic: flac.toString("ascii", 0, 4),
		sampleRate: (flac[18] << 12) | (flac[19] << 4) | (flac[20] >> 4),
		channels: ((flac[20] >> 1) & 0x07) + 1,
		bitsPerSample: (((flac[20] & 0x01) << 4) | (flac[21] >> 4)) + 1,
		totalSamples: flac.readUInt32BE(22) + (flac[21] & 0x0f) * 2 ** 32,
	}
	const pcm: Buffer[] = []
	let offset = 42
	let frames = 0
	let crcOk = true
	while (offset < flac.length) {
		if (flac.readUInt16BE(offset) !== 0xfff8)
			return { info, pcm: null, frames, crcOk: false }
		const numberBytes = utf8Length(flac[offset + 4])
		const headerEnd = offset + 4 + numberBytes + 2
		const samples = flac.readUInt16BE(headerEnd - 2) + 1
		if (crc8(flac.subarray(offset, headerEnd)) !== flac[headerEnd])
			crcOk = false
		let cursor = headerEnd + 1
		const channelData: Buffer[] = []
		for (let c = 0; c < info.channels; c++) {
			if (flac[cursor] !== 0x02)
				return { info, pcm: null, frames, crcOk: false }
			cursor++
			channelData.push(flac.subarray(cursor, cursor + samples * 2))
			cursor += samples * 2
		}
		if (crc16(flac.subarray(offset, cursor)) !== flac.readUInt16BE(cursor))
			crcOk = false
		const interleaved = Buffer.alloc(samples * info.channels * 2)
		for (let i = 0; i < samples; i++)
			for (let c = 0; c < info.channels; c++)
				interleaved.writeInt16LE(
					channelData[c].readInt16BE(i * 2),
					(i * info.channels + c) * 2,
				)
		pcm.push(interleaved)
		offset = cursor + 2
		frames++
	}
	return { info, pcm: Buffer.concat(pcm), frames, crcOk }
}

const zeroCrossingsPerSecond = (pcm: Buffer, sampleRate: number): number => {
	let crossings = 0
	for (let i = 1; i < pcm.length / 2; i++)
		if (pcm.readInt16LE((i - 1) * 2) < 0 !== pcm.readInt16LE(i * 2) < 0)
			crossings++
	return crossings / (pcm.length / 2 / sampleRate)
}

const varint = (value: number): Buffer => {
	const bytes: number[] = []
	let rest = value
	while (rest >= 0x80) {
		bytes.push((rest % 0x80) | 0x80)
		rest = Math.floor(rest / 0x80)
	}
	bytes.push(rest)
	return Buffer.from(bytes)
}

const fieldVarint = (field: number, value: number): Buffer =>
	Buffer.concat([varint(field * 8), varint(value)])

const fieldFixed32 = (field: number, value: number): Buffer => {
	const bytes = Buffer.alloc(4)
	bytes.writeUInt32LE(value, 0)
	return Buffer.concat([varint(field * 8 + 5), bytes])
}

const fieldBytes = (field: number, bytes: Buffer): Buffer =>
	Buffer.concat([varint(field * 8 + 2), varint(bytes.length), bytes])

const supportedFormat = (
	format: string,
	sampleRate: number,
	channels: number,
	purpose: number,
): Buffer =>
	Buffer.concat([
		fieldBytes(1, Buffer.from(format)),
		fieldVarint(2, sampleRate),
		fieldVarint(3, channels),
		...(purpose ? [fieldVarint(4, purpose)] : []),
		fieldVarint(5, 2),
	])

const checkFlac = (): void => {
	for (const channels of [1, 2]) {
		const pcm = tone(48000, 1.3, channels, 440)
		const encoder = createFlacEncoder({
			sampleRate: 48000,
			channels,
			blockSize: FLAC_BLOCK_SIZE,
		})
		const parts = [encoder.header(pcm.length / (2 * channels))]
		for (let o = 0; o < pcm.length; o += 3001)
			parts.push(encoder.push(pcm.subarray(o, o + 3001)))
		parts.push(encoder.flush())
		const decoded = decodeVerbatimFlac(Buffer.concat(parts))
		checker.check(
			`flac ${channels}ch: STREAMINFO carries rate, channels, depth and total samples`,
			decoded.info.magic === "fLaC" &&
				decoded.info.sampleRate === 48000 &&
				decoded.info.channels === channels &&
				decoded.info.bitsPerSample === 16 &&
				decoded.info.totalSamples === pcm.length / (2 * channels),
			JSON.stringify(decoded.info),
		)
		checker.check(
			`flac ${channels}ch: every frame header and body passes CRC-8 and CRC-16`,
			decoded.crcOk &&
				decoded.frames ===
					Math.ceil(pcm.length / (2 * channels) / FLAC_BLOCK_SIZE),
			`frames=${decoded.frames}`,
		)
		checker.check(
			`flac ${channels}ch: pushes in odd byte sizes decode back to the exact samples`,
			decoded.pcm?.equals(pcm) === true,
		)
	}
}

const checkConverter = (): void => {
	const source = tone(22050, 1, 1, 440)
	const oneShot = createPcm16Converter(
		{ sampleRate: 22050, channels: 1 },
		{ sampleRate: 48000, channels: 1 },
	)
	const whole = Buffer.concat([oneShot.push(source), oneShot.flush()])
	checker.check(
		"22.05 kHz → 48 kHz yields 48 000 samples for one second",
		whole.length / 2 === 48000,
		String(whole.length / 2),
	)
	const crossings = zeroCrossingsPerSecond(whole, 48000)
	checker.check(
		"resampling keeps a 440 Hz tone at 440 Hz",
		Math.abs(crossings - 880) <= 4,
		String(crossings),
	)
	const chunked = createPcm16Converter(
		{ sampleRate: 22050, channels: 1 },
		{ sampleRate: 48000, channels: 1 },
	)
	const pieces: Buffer[] = []
	for (let o = 0; o < source.length; o += 1001)
		pieces.push(chunked.push(source.subarray(o, o + 1001)))
	pieces.push(chunked.flush())
	checker.check(
		"odd-sized pushes (split samples) produce the same length as one push",
		Math.abs(Buffer.concat(pieces).length - whole.length) <= 4,
	)
	const stereo = tone(48000, 0.1, 2, 300)
	const mono = createPcm16Converter(
		{ sampleRate: 48000, channels: 2 },
		{ sampleRate: 48000, channels: 1 },
	)
	const mixed = Buffer.concat([mono.push(stereo), mono.flush()])
	const expected = Math.round(
		((stereo.readInt16LE(200 * 4) + stereo.readInt16LE(200 * 4 + 2)) /
			2 /
			32768) *
			32767,
	)
	checker.check(
		"stereo → mono averages the two channels",
		mixed.length === stereo.length / 2 &&
			Math.abs(mixed.readInt16LE(200 * 2) - expected) <= 1,
	)
}

const checkWavReader = (): void => {
	const pcm = tone(16000, 0.05, 1, 200)
	const plain = readWavPcm(wrapPcmToWav(pcm, 16000, 1, 16))
	checker.check(
		"reads format and samples from a plain WAV",
		plain?.sampleRate === 16000 &&
			plain.channels === 1 &&
			plain.bitsPerSample === 16 &&
			plain.pcm.equals(pcm),
	)
	const header = wrapPcmToWav(pcm, 16000, 1, 16)
	const list = Buffer.concat([
		Buffer.from("LIST"),
		Buffer.from([4, 0, 0, 0]),
		Buffer.from("INFO"),
	])
	const trailer = Buffer.concat([
		Buffer.from("id3 "),
		Buffer.from([2, 0, 0, 0]),
		Buffer.from([1, 2]),
	])
	const withChunks = Buffer.concat([
		header.subarray(0, 36),
		list,
		header.subarray(36),
		trailer,
	])
	withChunks.writeUInt32LE(withChunks.length - 8, 4)
	const parsed = readWavPcm(withChunks)
	checker.check(
		"skips chunks before data and ignores chunks after it",
		parsed?.pcm.equals(pcm) === true,
		String(parsed?.pcm.length),
	)
	const streaming = Buffer.from(header)
	streaming.writeUInt32LE(0xffffffff - 36, 40)
	checker.check(
		"a streaming header reads to the end of the buffer",
		readWavPcm(streaming)?.pcm.equals(pcm) === true,
	)
	checker.check("non-RIFF input is rejected", readWavPcm(pcm) === null)
}

const checkDeviceFormats = (): void => {
	const payload = Buffer.concat([
		fieldBytes(1, Buffer.from("media_player")),
		fieldFixed32(2, 2232357057),
		fieldBytes(3, Buffer.from("Media Player")),
		fieldVarint(8, 1),
		fieldBytes(9, supportedFormat("flac", 48000, 2, 0)),
		fieldBytes(9, supportedFormat("flac", 48000, 1, 1)),
		fieldVarint(11, 1200653),
	])
	const advertised = mediaPlayerFormatsOf(63, payload)
	checker.check(
		"parses the media player entity key",
		advertised?.key === 2232357057,
		String(advertised?.key),
	)
	checker.check(
		"parses both supported formats with their purpose",
		advertised?.formats.length === 2 &&
			advertised.formats[0].purpose === "default" &&
			advertised.formats[1].purpose === "announcement" &&
			advertised.formats[1].channels === 1,
		JSON.stringify(advertised?.formats),
	)
	checker.check(
		"other message types are ignored",
		mediaPlayerFormatsOf(62, payload) === null,
	)
	const chosen = playbackFormatOf(advertised?.formats ?? [])
	checker.check(
		"the announcement format wins and FLAC is requested",
		chosen?.sampleRate === 48000 &&
			chosen.channels === 1 &&
			chosen.encoding === "flac",
		JSON.stringify(chosen),
	)
	checker.check(
		"a non-FLAC advertised format falls back to WAV",
		playbackFormatOf([
			{ format: "wav", sampleRate: 16000, channels: 1, purpose: "default" },
		])?.encoding === "wav",
	)
	checker.check(
		"no advertised formats means no conversion",
		playbackFormatOf([]) === null,
	)
}

const checkUrls = (): void => {
	const url = withAudioFormat(
		"http://192.168.0.107:3100/audio/abc?kind=announce",
		{
			sampleRate: 48000,
			channels: 1,
			encoding: "flac",
		},
	)
	const parsed = new URL(url)
	checker.check(
		"an /audio URL gains rate, channels and format and keeps its query",
		parsed.searchParams.get("rate") === "48000" &&
			parsed.searchParams.get("channels") === "1" &&
			parsed.searchParams.get("format") === "flac" &&
			parsed.searchParams.get("kind") === "announce",
		url,
	)
	const external = "http://example.com/doorbell.mp3"
	checker.check(
		"URLs that are not Domia audio stay untouched",
		withAudioFormat(external, {
			sampleRate: 48000,
			channels: 1,
			encoding: "flac",
		}) === external,
	)
}

const main = (): void => {
	checkFlac()
	checkConverter()
	checkWavReader()
	checkDeviceFormats()
	checkUrls()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} audio-delivery checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

main()
