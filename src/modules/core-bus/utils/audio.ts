import { tmpdir } from "os"
import { join } from "path"
import { writeFile } from "fs/promises"
import { env } from "@/config"
import { fetchArrayBuffer } from "@/utils/http-client"
import { domiaBusLogger } from "@/utils"
import { getLocalIp } from "@/modules/network-sync"
import type { DomiaType } from "@/modules/core"
import type { ServeEntryType, DownloadAudioOptionsType } from "../types"

const TTL_MS = 5 * 60 * 1000 // 5 minutes

const serveRegistry = new Map<string, ServeEntryType>()

export const buildAudioUrl = (
	domia: DomiaType,
	interactionId: string,
): string | null => {
	const host = getLocalIp() ?? domia?.localIp
	if (!host) {
		domiaBusLogger.warn("cannot build audio URL: local IP unknown", {
			domiaKey: domia?.domiaKey,
			interactionId,
		})
		return null
	}
	const port = env?.HTTP_SERVER_PORT ?? "3000"
	return `http://${host}:${port}/audio/${interactionId}`
}

const sweepExpired = (): void => {
	const now = Date.now()
	for (const [id, entry] of serveRegistry) {
		if (now - entry.createdAt > TTL_MS) serveRegistry.delete(id)
	}
}

export const forgetServedAudio = (interactionIds: Iterable<string>): void => {
	for (const id of interactionIds) serveRegistry.delete(id)
}

export const registerAudioForServing = (
	interactionId: string,
	filePath: string,
): void => {
	if (serveRegistry.size > 64) sweepExpired()
	serveRegistry.set(interactionId, { filePath, createdAt: Date.now() })
}

export const getAudioFilePath = (interactionId: string): string | undefined => {
	const entry = serveRegistry.get(interactionId)
	if (!entry) return undefined
	if (Date.now() - entry.createdAt > TTL_MS) {
		serveRegistry.delete(interactionId)
		return undefined
	}
	return entry.filePath
}

export const downloadAudioToTemp = async (
	audioUrl: string,
	interactionId: string,
	options?: DownloadAudioOptionsType,
): Promise<string> => {
	const tempPath = join(tmpdir(), `domia-audio-${interactionId}.wav`)
	const buffer = await fetchArrayBuffer(audioUrl, options)
	await writeFile(tempPath, Buffer.from(buffer))
	return tempPath
}
