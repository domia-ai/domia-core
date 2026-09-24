import { createReadStream, existsSync } from "fs"
import { readFile, stat } from "fs/promises"
import { Readable } from "stream"
import {
	buildStreamingWavHeader,
	createFlacEncoder,
	createPcm16Converter,
	FLAC_BLOCK_SIZE,
	readWavPcm,
	wrapPcmToWav,
	httpServerLogger,
	type PcmFormatType,
} from "@/utils"
import { getHostedDomias } from "@/modules/core"
import {
	getInteractionById,
	getAnnouncementById,
} from "@/modules/session-manager"
import type { GetAudioRouteType, PresenceEntryResponseType } from "../types"
import { postIntercomBodySchema, getAudioQuerySchema } from "../schemas"
import {
	getAudioFilePath,
	getAudioStream,
	canDeliverIntercom,
	canDeliverBroadcast,
	getAllPresence,
	startDuplexIntercom,
	stopIntercom,
	stopIntercomTo,
} from "@/modules/core-bus"
import type { FastifyRequest, FastifyReply } from "fastify"

export const handleGetAudio = async (
	request: FastifyRequest<GetAudioRouteType>,
	reply: FastifyReply,
) => {
	const { interactionId } = request.params
	const { kind, rate, channels, format } = getAudioQuerySchema.parse(
		request.query,
	)
	httpServerLogger.debug("🔉 audio fetch", {
		interactionId,
		kind,
		rate,
		channels,
		format,
		client: request.ip,
	})
	const flac = format === "flac"
	const contentType = flac ? "audio/flac" : "audio/wav"
	const outputOf = (source: PcmFormatType): PcmFormatType => ({
		sampleRate: rate ?? source.sampleRate,
		channels: channels ?? source.channels,
	})
	const converterFor = (source: PcmFormatType, out: PcmFormatType) =>
		out.sampleRate === source.sampleRate && out.channels === source.channels
			? null
			: createPcm16Converter(source, out)
	if (kind === "tts") {
		const live = getAudioStream(interactionId)
		if (live) {
			const source = { sampleRate: live.sampleRate, channels: live.channels }
			const out = outputOf(source)
			const converter = converterFor(source, out)
			const encoder = flac
				? createFlacEncoder({ ...out, blockSize: FLAC_BLOCK_SIZE })
				: null
			const emit = (pcm: Buffer): Buffer => (encoder ? encoder.push(pcm) : pcm)
			const gen = async function* () {
				yield encoder
					? encoder.header()
					: buildStreamingWavHeader(out.sampleRate, out.channels, 16)
				try {
					for await (const chunk of live.queue.iter())
						yield emit(converter ? converter.push(chunk) : chunk)
				} catch {
					/* single-consumer already draining */
				}
				if (converter) yield emit(converter.flush())
				if (encoder) yield encoder.flush()
			}
			return reply.type(contentType).send(Readable.from(gen()))
		}
	}
	let filePath =
		kind === "tts" || kind === "announce"
			? getAudioFilePath(interactionId)
			: null
	if (!filePath && kind === "announce") {
		const row = await getAnnouncementById(interactionId)
		filePath = row?.audioPath ?? null
	}
	if (!filePath && kind !== "announce") {
		const row = await getInteractionById(interactionId)
		filePath =
			kind === "input"
				? (row?.inputAudioPath ?? null)
				: (row?.ttsAudioPath ?? null)
	}
	if (!filePath || !existsSync(filePath)) {
		return reply.code(404).send({ error: "Audio not found" })
	}
	const conversionRequested =
		rate !== undefined || channels !== undefined || flac
	const wav = conversionRequested ? readWavPcm(await readFile(filePath)) : null
	if (conversionRequested && wav?.bitsPerSample !== 16)
		httpServerLogger.warn(
			"🔉 audio conversion unsupported — serving original",
			{
				interactionId,
				kind,
				bitsPerSample: wav?.bitsPerSample ?? null,
			},
		)
	const out = wav ? outputOf(wav) : null
	const unchanged =
		!flac &&
		(!wav ||
			(out?.sampleRate === wav.sampleRate && out.channels === wav.channels))
	if (wav?.bitsPerSample === 16 && out && !unchanged) {
		const converter = converterFor(wav, out)
		const pcm = converter
			? Buffer.concat([converter.push(wav.pcm), converter.flush()])
			: wav.pcm
		const encoder = flac
			? createFlacEncoder({ ...out, blockSize: FLAC_BLOCK_SIZE })
			: null
		const body = encoder
			? Buffer.concat([
					encoder.header(pcm.length / (2 * out.channels)),
					encoder.push(pcm),
					encoder.flush(),
				])
			: wrapPcmToWav(pcm, out.sampleRate, out.channels, 16)
		return reply
			.type(contentType)
			.header("content-length", body.length)
			.send(body)
	}
	const { size } = await stat(filePath)
	return reply
		.type("audio/wav")
		.header("content-length", size)
		.send(createReadStream(filePath))
}

export const handleGetPresence = async () => {
	const byKey = new Map(getAllPresence().map((e) => [e.domiaKey, e]))
	const hosted = await getHostedDomias()
	const presence: PresenceEntryResponseType[] = await Promise.all(
		hosted.map(async ({ domiaKey }) => {
			const entry = byKey.get(domiaKey) ?? {
				domiaKey,
				status: "idle" as const,
				lastActiveAt: null,
				satellites: [],
			}
			return {
				...entry,
				canIntercom: await canDeliverIntercom(domiaKey),
				canBroadcast: await canDeliverBroadcast(domiaKey),
			}
		}),
	)
	return { presence }
}

export const handlePostIntercom = async (body: unknown) => {
	const { from, to, stop } = postIntercomBodySchema.parse(body)
	if (stop || !to) {
		const stopped = await stopIntercom(from)
		await stopIntercomTo(from)
		return { intercom: "stopped" as const, from, stopped }
	}
	const started = await startDuplexIntercom(from, to, {
		sampleRate: 16000,
		channels: 1,
	})
	return {
		intercom: started ? ("started" as const) : ("failed" as const),
		from,
		to,
	}
}
