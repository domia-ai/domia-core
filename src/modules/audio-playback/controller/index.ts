import { AUDIO_PLAYBACK_ENGINE_ENUM_VALUES } from "@/db"
import { type DomiaType } from "@/modules/core"
import { domiaError, AUDIO_PLAYBACK_ERRORS, audioPlaybackLogger } from "@/utils"

import { audioPlaybackEngines } from "../engines"
import { runSoxStream } from "../engines/sox"
import type { AudioPlaybackResult, SoxStreamOptionsType } from "../types"

export const playAudio = async (
	domia: DomiaType,
	filePath: string,
): Promise<AudioPlaybackResult> => {
	const audioPlaybackConfig = domia?.audioPlaybackConfig
	const engine = audioPlaybackConfig?.engine

	if (!engine || !AUDIO_PLAYBACK_ENGINE_ENUM_VALUES?.includes(engine)) {
		throw domiaError(AUDIO_PLAYBACK_ERRORS.AUDIO_PLAYBACK_ENGINE_NOT_FOUND, {
			logger: audioPlaybackLogger,
			meta: {
				engine,
			},
		})
	}

	const handler = audioPlaybackEngines[engine]

	return await handler(domia, filePath)
}

export const playAudioStream = async (
	domia: DomiaType,
	chunks: AsyncIterable<Buffer>,
	options: SoxStreamOptionsType,
): Promise<AudioPlaybackResult> => {
	return runSoxStream(domia, chunks, options)
}
