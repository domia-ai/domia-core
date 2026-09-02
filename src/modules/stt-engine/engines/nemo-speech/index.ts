import { readFile } from "fs/promises"

import { STT_ENGINE_ENUM, DEFAULT_STT_TIMEOUT_MS } from "@/db"
import { sttEngineLogger, STT_ERRORS, domiaError, wrapPcmToWav } from "@/utils"
import type { DomiaType } from "@/modules/core"

import { createNemoSpeechSession } from "./session"
import type { SttEngineAdapterType } from "../../types"

const SAMPLE_RATE = 16000

const transcribeRemote = async (
	domia: DomiaType,
	wav: Buffer,
): Promise<string> => {
	const config = domia.sttConfig
	const baseUrl = config?.baseUrl?.trim()
	if (!baseUrl)
		throw domiaError(STT_ERRORS.TRANSCRIPTION_FAILED, {
			logger: sttEngineLogger,
			meta: {
				domiaId: domia.id,
				reason: "nemo-speech STT requires sttConfig.baseUrl",
			},
		})
	const form = new FormData()
	form.append(
		"file",
		new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
		"audio.wav",
	)
	if (config?.language) form.append("language", config.language)
	if (config?.modelName) form.append("model", config.modelName)
	const headers: Record<string, string> = {}
	if (config?.apiKey?.trim())
		headers.authorization = `Bearer ${config.apiKey.trim()}`
	const started = Date.now()
	const res = await fetch(
		`${baseUrl.replace(/\/$/, "")}/audio/transcriptions`,
		{
			method: "POST",
			headers,
			body: form,
			signal: AbortSignal.timeout(config?.timeoutMs ?? DEFAULT_STT_TIMEOUT_MS),
		},
	)
	if (!res.ok)
		throw domiaError(STT_ERRORS.TRANSCRIPTION_FAILED, {
			logger: sttEngineLogger,
			meta: { domiaId: domia.id, status: res.status },
		})
	const body = (await res.json()) as { text?: string }
	sttEngineLogger.debug("nemo-speech batch transcription", {
		domiaId: domia.id,
		execMs: Date.now() - started,
	})
	return (body.text ?? "").trim()
}

export const nemoSpeechEngine: SttEngineAdapterType = {
	id: STT_ENGINE_ENUM.NEMO_SPEECH,
	capabilities: {
		streaming: true,
		expectedSampleRate: SAMPLE_RATE,
		external: true,
	},
	run: async (domia, filePath, onTiming) => {
		const started = Date.now()
		const text = await transcribeRemote(domia, await readFile(filePath))
		onTiming?.({ queueWaitMs: 0, execMs: Date.now() - started })
		return text
	},
	runPcm: async (domia, pcm, onTiming) => {
		const started = Date.now()
		const text = await transcribeRemote(
			domia,
			wrapPcmToWav(pcm, SAMPLE_RATE, 1, 16),
		)
		onTiming?.({ queueWaitMs: 0, execMs: Date.now() - started })
		return text
	},
	runStream: async (domia, audioStream) => {
		const session = createNemoSpeechSession(domia)
		if (!session)
			throw domiaError(STT_ERRORS.TRANSCRIPTION_FAILED, {
				logger: sttEngineLogger,
				meta: {
					domiaId: domia.id,
					reason: "nemo-speech STT requires sttConfig.baseUrl",
				},
			})
		for await (const chunk of audioStream) session.pushChunk(chunk)
		return session.finish()
	},
	createSession: (domia) => createNemoSpeechSession(domia),
}
