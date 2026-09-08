import { spawn } from "child_process"
import fs from "fs"
import path from "path"

import { type DomiaType } from "@/modules/core"
import { getIntercom } from "@/modules/core-bus/utils/intercom-registry"
import {
	audioCaptureLogger,
	domiaError,
	AUDIO_ERRORS,
	findOnnxFile,
	int16BufferToFloat32,
	resolveQuantization,
	type QuantizationType,
} from "@/utils"
import { createKeywordSpotter } from "@/utils/ml-runtime"
import { createCaptureEnhancer } from "@/modules/speech-enhancer"
import { verifyWake, wakeVerifierWindowBytes } from "@/modules/wake-verifier"
import { WAKE_VERIFIER_ENUM } from "@/db"

import {
	type CaptureCallbacksType,
	type CaptureHandleType,
	type KwsPathsType,
} from "../../types"
import { publishMicChunk, setMicTapFormat } from "../../utils/mic-tap"
import { createEchoGate, clearPlaybackReference } from "../../utils/echo-gate"

export const KWS_SAMPLE_RATE = 16000
const SAMPLE_RATE = KWS_SAMPLE_RATE
const CHUNK_SAMPLES = 1600
const RESPAWN_BASE_MS = 1000
const RESPAWN_MAX_MS = 30000

const resolveKwsPaths = (
	modelDir: string,
	quantization: QuantizationType,
): KwsPathsType | null => {
	const dir = path.resolve(modelDir)
	if (!fs.existsSync(dir)) return null
	const encoder = findOnnxFile({ dir, prefix: "encoder", quantization })
	const decoder = findOnnxFile({ dir, prefix: "decoder", quantization })
	const joiner = findOnnxFile({ dir, prefix: "joiner", quantization })
	if (!encoder || !decoder || !joiner) return null
	return {
		dir,
		encoder,
		decoder,
		joiner,
		tokens: path.join(dir, "tokens.txt"),
		keywords: path.join(dir, "keywords.txt"),
	}
}

export const runKws = (
	domia: DomiaType,
	callbacks?: CaptureCallbacksType,
): Promise<CaptureHandleType> => {
	const fail = (err: Error): Promise<CaptureHandleType> => {
		void callbacks?.onError?.(err)
		return Promise.reject(err)
	}
	const wakeWordConfig = domia.wakeWordConfig
	if (!wakeWordConfig) {
		return fail(
			domiaError(AUDIO_ERRORS.WAKE_WORD_CONFIG_NOT_FOUND, {
				logger: audioCaptureLogger,
			}),
		)
	}

	const modelPath = wakeWordConfig.customModelPath
	if (!modelPath) {
		return fail(
			domiaError(AUDIO_ERRORS.WAKE_WORD_MODEL_PATH_MISSING, {
				logger: audioCaptureLogger,
				meta: { domiaId: domia.id, engine: "KWS" },
			}),
		)
	}

	const quantization = resolveQuantization(wakeWordConfig.quantization)
	const paths = resolveKwsPaths(modelPath, quantization)
	if (!paths) {
		return fail(
			domiaError(AUDIO_ERRORS.WAKE_WORD_MODEL_FILES_MISSING, {
				logger: audioCaptureLogger,
				meta: { modelPath, hint: "npm run setup:models:kws" },
			}),
		)
	}

	const missing = [paths.tokens, paths.keywords].filter(
		(p) => !fs.existsSync(p),
	)
	if (missing.length > 0) {
		return fail(
			domiaError(AUDIO_ERRORS.WAKE_WORD_MODEL_FILES_MISSING, {
				logger: audioCaptureLogger,
				meta: { modelPath, missing },
			}),
		)
	}

	const cooldownMs = Math.round(wakeWordConfig.cooldown * 1000)
	const config = {
		featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
		modelConfig: {
			transducer: {
				encoder: paths.encoder,
				decoder: paths.decoder,
				joiner: paths.joiner,
			},
			tokens: paths.tokens,
			numThreads: wakeWordConfig.numThreads,
			provider: wakeWordConfig.provider,
			debug: 0,
		},
		keywordsFile: paths.keywords,
		keywordsThreshold: wakeWordConfig.threshold,
		keywordsScore: wakeWordConfig.sensitivity,
	}

	audioCaptureLogger.info("🎤 Starting KWS wake-word engine", {
		domiaId: domia.id,
		modelDir: paths.dir,
		quantization,
		encoder: paths.encoder,
		keywordsFile: paths.keywords,
	})

	const kws = createKeywordSpotter(config)
	const stream = kws.createStream()
	const enhancer = createCaptureEnhancer(wakeWordConfig, "kws")
	const echoGate = wakeWordConfig.echoResidualGateEnabled
		? createEchoGate(domia.id, wakeWordConfig)
		: null
	const verifierWindowBytes =
		wakeWordConfig.wakeVerifier === WAKE_VERIFIER_ENUM.NONE
			? 0
			: wakeVerifierWindowBytes(wakeWordConfig, SAMPLE_RATE)
	let verifierWindow = Buffer.alloc(0)
	let verifying = false
	let lastDetectionAt = 0
	let stopped = false
	let recProc: ReturnType<typeof spawn> | null = null
	let respawnDelayMs = RESPAWN_BASE_MS
	const targetBytes = CHUNK_SAMPLES * 2

	const rememberForVerifier = (data: Buffer): void => {
		if (verifierWindowBytes === 0) return
		verifierWindow = Buffer.concat([verifierWindow, data])
		if (verifierWindow.length > verifierWindowBytes)
			verifierWindow = verifierWindow.subarray(
				verifierWindow.length - verifierWindowBytes,
			)
	}

	const acceptWake = (keyword: string): void => {
		if (verifierWindowBytes === 0) {
			void callbacks?.onWake?.(keyword)
			return
		}
		if (verifying) return
		verifying = true
		const window = Buffer.from(verifierWindow)
		void verifyWake({ pcm: window, sampleRate: SAMPLE_RATE }, wakeWordConfig)
			.then((verdict) => {
				if (verdict.accepted) {
					audioCaptureLogger.info("✅ wake verified", {
						keyword,
						verifier: wakeWordConfig.wakeVerifier,
						score: Number(verdict.score.toFixed(3)),
					})
					void callbacks?.onWake?.(keyword)
				} else {
					audioCaptureLogger.info("🙈 wake rejected by verifier", {
						keyword,
						verifier: wakeWordConfig.wakeVerifier,
						score: Number(verdict.score.toFixed(3)),
						detail: verdict.detail,
					})
				}
			})
			.finally(() => {
				verifying = false
			})
	}

	setMicTapFormat(domia.id, {
		sampleRate: SAMPLE_RATE,
		bitsPerSample: 16,
		channels: 1,
	})

	const startRec = (): void => {
		const proc = spawn("rec", [
			"-q",
			"-t",
			"raw",
			"-r",
			String(SAMPLE_RATE),
			"-e",
			"signed",
			"-b",
			"16",
			"-c",
			"1",
			"-",
		])
		recProc = proc
		let leftover = Buffer.alloc(0)
		let intercomWarned = false

		proc.stdout.on("data", (raw: Buffer) => {
			respawnDelayMs = RESPAWN_BASE_MS
			const data = enhancer.process(raw)
			if (data.length === 0) return
			publishMicChunk(domia.id, data)
			rememberForVerifier(data)
			echoGate?.observe(data)
			const intercom = getIntercom(domia.domiaKey)
			if (intercom) {
				Promise.resolve(intercom.sink.write(data)).catch((err: unknown) => {
					if (intercomWarned) return
					intercomWarned = true
					audioCaptureLogger.warn("[kws] intercom sink write failed", { err })
				})
			}
			leftover = Buffer.concat([leftover, data])
			while (leftover.length >= targetBytes) {
				const chunk = leftover.subarray(0, targetBytes)
				leftover = leftover.subarray(targetBytes)
				const samples = int16BufferToFloat32(chunk)
				stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples })
				while (kws.isReady(stream)) {
					kws.decode(stream)
					const result = kws.getResult(stream)
					if (result.keyword && result.keyword.length > 0) {
						const now = Date.now()
						if (now - lastDetectionAt > cooldownMs) {
							lastDetectionAt = now
							audioCaptureLogger.info("✨ wake detected", {
								keyword: result.keyword,
							})
							kws.reset(stream)
							acceptWake(result.keyword)
						}
					}
				}
			}
		})

		proc.stderr.on("data", (data: Buffer) => {
			const msg = data.toString().trim()
			if (!msg) return
			if (msg.includes("can't set sample rate")) return
			audioCaptureLogger.warn(`[kws:rec] ${msg}`)
		})

		proc.on("error", (err) => {
			audioCaptureLogger.error("[kws:rec] error", { err })
			void callbacks?.onError?.(err)
		})

		proc.on("close", (code) => {
			if (stopped) {
				audioCaptureLogger.info(`[kws] rec process terminated code=${code}`)
				return
			}
			audioCaptureLogger.error(
				`[kws] rec died unexpectedly (code=${code}) — respawning in ${respawnDelayMs}ms`,
			)
			const timer = setTimeout(() => {
				if (!stopped) startRec()
			}, respawnDelayMs)
			timer.unref()
			respawnDelayMs = Math.min(respawnDelayMs * 2, RESPAWN_MAX_MS)
		})
	}

	startRec()

	return Promise.resolve({
		stop: () => {
			stopped = true
			enhancer.close()
			clearPlaybackReference(domia.id)
			try {
				recProc?.kill()
			} catch {
				/* already gone */
			}
		},
	})
}
