import fs from "fs/promises"
import os from "os"
import path from "path"

import { AUDIO_PLAYBACK_ENGINE_ENUM_VALUES } from "@/db"
import { type DomiaType } from "@/modules/core"
import {
	domiaError,
	AUDIO_PLAYBACK_ERRORS,
	audioPlaybackLogger,
	generateUuid,
	wrapPcmToWav,
} from "@/utils"

import { audioPlaybackEngines } from "../engines"
import { runSox, runSoxStream } from "../engines/sox"
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

const collectAndPlayFile = async (
	domia: DomiaType,
	chunks: AsyncIterable<Buffer>,
	options: SoxStreamOptionsType,
): Promise<AudioPlaybackResult> => {
	audioPlaybackLogger.info("🔊 Collecting streamed PCM for file playback", {
		domiaId: domia?.id,
		sampleRate: options.sampleRate,
		channels: options.channels,
	})

	const collected: Buffer[] = []
	let totalBytes = 0

	for await (const chunk of chunks) {
		collected.push(chunk)
		totalBytes += chunk.length
	}

	if (totalBytes === 0) {
		throw new Error("streamed TTS produced no PCM bytes")
	}

	const pcm = Buffer.concat(collected)
	const wav = wrapPcmToWav(
		pcm,
		options.sampleRate,
		options.channels,
		options.bitsPerSample,
	)
	const tmpFile = path.join(
		os.tmpdir(),
		`domia-tts-stream-${generateUuid()}.wav`,
	)
	await fs.writeFile(tmpFile, wav)
	audioPlaybackLogger.debug("🔇 Streamed PCM written to temp WAV", {
		domiaId: domia.id,
		tmpFile,
		totalBytes,
	})

	try {
		options.onFirstChunkWritten?.()
		return await runSox(domia, tmpFile)
	} finally {
		fs.unlink(tmpFile).catch(() => undefined)
	}
}

export const playAudioStream = async (
	domia: DomiaType,
	chunks: AsyncIterable<Buffer>,
	options: SoxStreamOptionsType,
): Promise<AudioPlaybackResult> => {
	const streamingEnabled = domia.audioPlaybackConfig?.streamingEnabled ?? true
	if (streamingEnabled) {
		return runSoxStream(domia, chunks, options)
	}
	audioPlaybackLogger.warn(
		"⚠️ audioPlaybackConfig.streamingEnabled=false — buffering full audio before playback (higher time-to-first-audio)",
		{ domiaId: domia?.id },
	)
	return collectAndPlayFile(domia, chunks, options)
}
