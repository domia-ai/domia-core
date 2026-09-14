import fs from "fs"
import path from "path"

import { SPEECH_ENHANCER_ENGINE_ENUM, DEFAULT_PCM_SAMPLE_RATE } from "@/db"
import { createOnlineSpeechDenoiser } from "@/utils/ml-runtime"
import { int16BufferToFloat32, float32ToInt16Buffer } from "@/utils"
import type {
	SpeechEnhancerEngineAdapterType,
	SpeechEnhancerStageType,
	SpeechEnhancerTuningType,
} from "../../types"

const SAMPLE_RATE = DEFAULT_PCM_SAMPLE_RATE

const resolveModelPath = (modelPath: string): string => path.resolve(modelPath)

const available = (modelPath: string): boolean =>
	fs.existsSync(resolveModelPath(modelPath))

const createStage = (
	tuning: SpeechEnhancerTuningType,
): SpeechEnhancerStageType => {
	const resolved = resolveModelPath(tuning.modelPath)
	const denoiser = createOnlineSpeechDenoiser({
		model: {
			dpdfnet: { model: resolved },
			numThreads: tuning.numThreads,
			provider: tuning.provider,
			debug: false,
		},
	})
	const frameShift = denoiser.frameShiftInSamples
	let pending = new Float32Array(0)
	let closed = false

	const runFrames = (samples: Float32Array): Float32Array => {
		const joined = new Float32Array(pending.length + samples.length)
		joined.set(pending, 0)
		joined.set(samples, pending.length)
		const usable = joined.length - (joined.length % frameShift)
		pending = joined.subarray(usable)
		if (usable === 0) return new Float32Array(0)
		const out = denoiser.run({
			samples: joined.subarray(0, usable),
			sampleRate: SAMPLE_RATE,
			enableExternalBuffer: true,
		})
		return out.samples
	}

	return {
		active: true,
		process: (pcm) => {
			if (closed) return pcm
			return float32ToInt16Buffer(runFrames(int16BufferToFloat32(pcm)))
		},
		flush: () => {
			if (closed) return Buffer.alloc(0)
			const tail = denoiser.flush(true)
			pending = new Float32Array(0)
			return float32ToInt16Buffer(tail.samples)
		},
		close: () => {
			closed = true
		},
	}
}

export const dpdfnetEngine: SpeechEnhancerEngineAdapterType = {
	id: SPEECH_ENHANCER_ENGINE_ENUM.DPDFNET,
	capabilities: { sampleRate: SAMPLE_RATE },
	available,
	createStage,
}
