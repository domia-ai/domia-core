import { env } from "@/config"
import {
	ML_ERRORS,
	domiaError,
	fetchWithRetry,
	fetchWithTimeout,
	mlClientLogger,
} from "@/utils"
import { DEFAULT_TIMEOUT_MS, HEALTH_TIMEOUT_MS } from "../constants"
import {
	type SynthesizeTtsParams,
	type SynthesizeTtsResult,
	type TranscribeSttParams,
	type TranscribeSttResult,
	type EnginesResponse,
} from "../types"

const baseUrl = () => `http://${env.DOMIA_ML_HOST}:${env.DOMIA_ML_PORT}`

const postJson = async (
	path: string,
	body: unknown,
	timeoutMs: number,
): Promise<Response> =>
	fetchWithRetry(
		`${baseUrl()}${path}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
		{
			timeoutMs,
			retries: 1,
			onRetry: (err) =>
				mlClientLogger.warn(`retrying ${path} after error: ${err}`),
		},
	)

export const pingMlServer = async (): Promise<boolean> => {
	try {
		const res = await fetchWithTimeout(
			`${baseUrl()}/health`,
			{ method: "GET" },
			HEALTH_TIMEOUT_MS,
		)
		return res.ok
	} catch {
		return false
	}
}

export const listEngines = async (): Promise<EnginesResponse> => {
	const res = await fetchWithTimeout(
		`${baseUrl()}/engines`,
		{ method: "GET" },
		HEALTH_TIMEOUT_MS,
	)
	if (!res.ok) {
		throw domiaError(ML_ERRORS.SERVER_UNAVAILABLE, {
			logger: mlClientLogger,
			meta: { status: res.status },
		})
	}
	return (await res.json()) as EnginesResponse
}

export const synthesizeTts = async (
	params: SynthesizeTtsParams,
): Promise<SynthesizeTtsResult> => {
	const { engine, text, voice, timeoutMs = DEFAULT_TIMEOUT_MS } = params
	let res: Response
	try {
		res = await postJson("/tts/synthesize", { engine, text, voice }, timeoutMs)
	} catch (err) {
		throw domiaError(ML_ERRORS.SERVER_UNAVAILABLE, {
			logger: mlClientLogger,
			meta: { engine, error: String(err) },
		})
	}
	if (!res.ok) {
		const detail = await res.text().catch(() => "")
		throw domiaError(ML_ERRORS.SYNTHESIS_FAILED, {
			logger: mlClientLogger,
			meta: { engine, status: res.status, detail },
		})
	}
	const audio = Buffer.from(await res.arrayBuffer())
	const voiceUsed = res.headers.get("x-domia-voice") || voice || ""
	return { audio, engineUsed: engine, voiceUsed }
}

export const transcribeStt = async (
	params: TranscribeSttParams,
): Promise<TranscribeSttResult> => {
	const { engine, filePath, modelName, timeoutMs = DEFAULT_TIMEOUT_MS } = params
	let res: Response
	try {
		res = await postJson(
			"/stt/transcribe",
			{ engine, file_path: filePath, model_name: modelName },
			timeoutMs,
		)
	} catch (err) {
		throw domiaError(ML_ERRORS.SERVER_UNAVAILABLE, {
			logger: mlClientLogger,
			meta: { engine, error: String(err) },
		})
	}
	if (!res.ok) {
		const detail = await res.text().catch(() => "")
		throw domiaError(ML_ERRORS.TRANSCRIPTION_FAILED, {
			logger: mlClientLogger,
			meta: { engine, status: res.status, detail },
		})
	}
	const data = (await res.json()) as { transcript: string }
	return { transcript: data.transcript, engineUsed: engine }
}
