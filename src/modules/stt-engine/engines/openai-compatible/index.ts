import { readFile } from "fs/promises"

import { STT_ENGINE_ENUM, DEFAULT_STT_TIMEOUT_MS } from "@/db"
import { sttEngineLogger, STT_ERRORS, domiaError, wrapPcmToWav } from "@/utils"
import type { DomiaType } from "@/modules/core"

import type { SttEngineAdapterType } from "../../types"

const SAMPLE_RATE = 16000

const ASR_TEXT_MARKER = "<asr_text>"

const cleanTranscript = (text: string): string => {
	const marker = text.indexOf(ASR_TEXT_MARKER)
	return (
		marker >= 0 ? text.slice(marker + ASR_TEXT_MARKER.length) : text
	).trim()
}

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
				reason: "openai-compatible STT requires sttConfig.baseUrl",
			},
		})
	const form = new FormData()
	form.append(
		"file",
		new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
		"audio.wav",
	)
	form.append("response_format", "json")
	if (config?.language) form.append("language", config.language)
	if (config?.modelName) form.append("model", config.modelName)
	const headers: Record<string, string> = {}
	if (config?.apiKey?.trim())
		headers.authorization = `Bearer ${config.apiKey.trim()}`
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
	return cleanTranscript(body.text ?? "")
}

export const openAiCompatibleSttEngine: SttEngineAdapterType = {
	id: STT_ENGINE_ENUM.OPENAI_COMPATIBLE,
	capabilities: {
		streaming: false,
		expectedSampleRate: SAMPLE_RATE,
	},
	run: async (domia, filePath) =>
		transcribeRemote(domia, await readFile(filePath)),
	runPcm: (domia, pcm) =>
		transcribeRemote(domia, wrapPcmToWav(pcm, SAMPLE_RATE, 1, 16)),
}
