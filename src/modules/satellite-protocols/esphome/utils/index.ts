import type { AudioDeliveryFormatType } from "@/utils"
import type {
	EsphomeAudioFormatType,
	EsphomeMediaPlayerFormatsType,
} from "../types"

const LIST_ENTITIES_MEDIA_PLAYER_RESPONSE = 63
const ENTITY_KEY_FIELD = 2
const MEDIA_PLAYER_SUPPORTED_FORMATS_FIELD = 9
const FORMAT_FIELD = 1
const SAMPLE_RATE_FIELD = 2
const CHANNELS_FIELD = 3
const PURPOSE_FIELD = 4
const PURPOSE_ANNOUNCEMENT = 1
const WIRE_VARINT = 0
const WIRE_FIXED64 = 1
const WIRE_LENGTH_DELIMITED = 2
const WIRE_FIXED32 = 5

const readVarint = (buf: Buffer, offset: number): [number, number] => {
	let value = 0
	let shift = 0
	let read = 0
	while (offset + read < buf.length) {
		const byte = buf[offset + read]
		value += (byte & 0x7f) * 2 ** shift
		read++
		if ((byte & 0x80) === 0) break
		shift += 7
	}
	return [value, read]
}

const protobufFields = (buf: Buffer): [number, number | Buffer][] => {
	const fields: [number, number | Buffer][] = []
	let offset = 0
	while (offset < buf.length) {
		const [tag, tagBytes] = readVarint(buf, offset)
		offset += tagBytes
		const field = Math.floor(tag / 8)
		const wire = tag % 8
		if (wire === WIRE_VARINT) {
			const [value, bytes] = readVarint(buf, offset)
			offset += bytes
			fields.push([field, value])
		} else if (wire === WIRE_LENGTH_DELIMITED) {
			const [length, bytes] = readVarint(buf, offset)
			offset += bytes
			fields.push([field, buf.subarray(offset, offset + length)])
			offset += length
		} else if (wire === WIRE_FIXED32) {
			if (offset + 4 > buf.length) break
			fields.push([field, buf.readUInt32LE(offset)])
			offset += 4
		} else if (wire === WIRE_FIXED64) {
			offset += 8
		} else {
			break
		}
	}
	return fields
}

const numberField = (
	fields: [number, number | Buffer][],
	field: number,
): number | null => {
	const hit = fields.find(([f, v]) => f === field && typeof v === "number")
	return hit ? (hit[1] as number) : null
}

export const mediaPlayerFormatsOf = (
	type: number,
	payload: Buffer,
): EsphomeMediaPlayerFormatsType | null => {
	if (type !== LIST_ENTITIES_MEDIA_PLAYER_RESPONSE) return null
	const fields = protobufFields(payload)
	const formats = fields.flatMap(([field, value]): EsphomeAudioFormatType[] => {
		if (
			field !== MEDIA_PLAYER_SUPPORTED_FORMATS_FIELD ||
			!Buffer.isBuffer(value)
		)
			return []
		const inner = protobufFields(value)
		const sampleRate = numberField(inner, SAMPLE_RATE_FIELD)
		const channels = numberField(inner, CHANNELS_FIELD)
		if (!sampleRate || !channels) return []
		const format = inner.find(([f]) => f === FORMAT_FIELD)?.[1]
		return [
			{
				format: Buffer.isBuffer(format) ? format.toString("utf8") : "",
				sampleRate,
				channels,
				purpose:
					numberField(inner, PURPOSE_FIELD) === PURPOSE_ANNOUNCEMENT
						? "announcement"
						: "default",
			},
		]
	})
	return { key: numberField(fields, ENTITY_KEY_FIELD), formats }
}

export const playbackFormatOf = (
	formats: EsphomeAudioFormatType[],
): AudioDeliveryFormatType | null => {
	const chosen =
		formats.find((f) => f.purpose === "announcement") ?? formats.at(0)
	return chosen
		? {
				sampleRate: chosen.sampleRate,
				channels: chosen.channels,
				encoding: chosen.format === "flac" ? "flac" : "wav",
			}
		: null
}
