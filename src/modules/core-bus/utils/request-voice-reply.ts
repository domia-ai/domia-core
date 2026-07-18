import { existsSync } from "fs"
import path from "path"

import { getWavDurationMs } from "@/utils"
import type { DomiaType } from "@/modules/core"
import { runInteraction } from "./run-interaction"
import type {
	RequestVoiceReplyOptions,
	RequestVoiceReplyResult,
} from "../types"

export const requestVoiceReply = async (
	domia: DomiaType,
	audioPath: string,
	options: RequestVoiceReplyOptions = {},
): Promise<RequestVoiceReplyResult> => {
	const {
		timeoutMs,
		speak = true,
		onStage,
		interactionId: providedId,
		satelliteId,
		satelliteProtocol,
	} = options

	const absPath = path.resolve(audioPath)
	if (!existsSync(absPath)) {
		throw new Error(`requestVoiceReply: audio file not found: ${absPath}`)
	}

	const result = await runInteraction(domia, {
		input: {
			kind: "audio_file",
			filePath: absPath,
			inputAudioMs: (await getWavDurationMs(absPath)) ?? undefined,
		},
		requestedOutput: { kind: speak ? "voice" : "text" },
		source: satelliteId ? "satellite" : "http",
		audioDelivery:
			domia.runtimeCapabilities?.playback === true
				? "local-playback"
				: "audio-url",
		interactionId: providedId,
		satelliteId,
		satelliteProtocol,
		timeoutMs,
		onStage,
		liveTurn: true,
		prefetch: true,
		reflect: true,
	})

	return {
		interactionId: result.interactionId,
		transcript: result.transcript,
		reply: result.reply,
		ttsFilePath: result.ttsFilePath,
	}
}
