import { createReadStream, existsSync } from "fs"
import { Readable } from "stream"
import { buildStreamingWavHeader } from "@/utils"
import { getHostedDomias } from "@/modules/core"
import {
	getInteractionById,
	getAnnouncementById,
} from "@/modules/session-manager"
import type { GetAudioRouteType } from "../types"
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
	const { kind } = getAudioQuerySchema.parse(request.query)
	if (kind === "tts") {
		const live = getAudioStream(interactionId)
		if (live) {
			const header = buildStreamingWavHeader(live.sampleRate, live.channels, 16)
			const gen = async function* () {
				yield header
				try {
					for await (const chunk of live.queue.iter()) yield chunk
				} catch {
					/* single-consumer already draining */
				}
			}
			return reply.type("audio/wav").send(Readable.from(gen()))
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
	const stream = createReadStream(filePath)
	return reply.type("audio/wav").send(stream)
}

export const handleGetPresence = async () => {
	const byKey = new Map(getAllPresence().map((e) => [e.domiaKey, e]))
	const hosted = await getHostedDomias()
	const presence = await Promise.all(
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
