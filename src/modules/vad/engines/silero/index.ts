import fs from "fs"
import path from "path"

import { audioCaptureLogger, domiaError, AUDIO_ERRORS } from "@/utils"
import { VAD_ENGINE_ENUM } from "@/db"
import { createVad } from "@/utils/ml-runtime"
import type {
	VadEngineAdapterType,
	VadSessionType,
	VadTuningType,
} from "../../types"

const SAMPLE_RATE = 16000
const WINDOW_SIZE = 512

const buildConfig = (modelPath: string, tuning: VadTuningType) => {
	const resolved = path.resolve(modelPath)
	if (!fs.existsSync(resolved)) {
		throw domiaError(AUDIO_ERRORS.WAKE_WORD_CONFIG_NOT_FOUND, {
			logger: audioCaptureLogger,
			meta: {
				message: `Silero VAD model not found at ${resolved}. Run npm run setup:models:vad`,
				modelPath: resolved,
			},
		})
	}
	return {
		sileroVad: {
			model: resolved,
			threshold: tuning.threshold,
			minSpeechDuration: 0.25,
			minSilenceDuration: tuning.minSilenceS,
			windowSize: WINDOW_SIZE,
		},
		sampleRate: SAMPLE_RATE,
		debug: false,
		numThreads: tuning.numThreads,
		provider: tuning.provider,
	}
}

const createSession = (
	modelPath: string,
	tuning: VadTuningType,
): VadSessionType => {
	const vad = createVad(buildConfig(modelPath, tuning), 30)
	let everDetected = false
	let lastDetectedAt = Date.now()

	return {
		acceptSamples: (samples: Float32Array) => {
			vad.acceptWaveform(samples)
			if (vad.isDetected()) {
				everDetected = true
				lastDetectedAt = Date.now()
			}
		},
		isSpeechActive: () => vad.isDetected(),
		hasCompletedSegment: () => {
			if (!everDetected) return false
			const silenceMs = Date.now() - lastDetectedAt
			return silenceMs >= tuning.endOfSpeechMs
		},
		silenceMs: () => (everDetected ? Date.now() - lastDetectedAt : 0),
		everDetected: () => everDetected,
		reset: () => {
			vad.reset()
			everDetected = false
			lastDetectedAt = Date.now()
		},
	}
}

export const sileroVadEngine: VadEngineAdapterType = {
	id: VAD_ENGINE_ENUM.SILERO,
	capabilities: {
		sampleRate: SAMPLE_RATE,
		windowSize: WINDOW_SIZE,
	},
	createSession,
}
