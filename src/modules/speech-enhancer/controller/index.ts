import type { SelectWakeWordConfigType } from "@/db"
import { audioCaptureLogger, createLogOnce } from "@/utils"

import { getSpeechEnhancerEngine } from "../engines"
import type { SpeechEnhancerStageType } from "../types"

const passthroughStage: SpeechEnhancerStageType = {
	active: false,
	process: (pcm) => pcm,
	flush: () => Buffer.alloc(0),
	close: () => undefined,
}

const warnOnce = createLogOnce(audioCaptureLogger).warn

export const createCaptureEnhancer = (
	config: Pick<
		SelectWakeWordConfigType,
		| "denoiseEnabled"
		| "denoiseEngine"
		| "denoiseModelPath"
		| "denoiseNumThreads"
		| "denoiseProvider"
		| "sampleRate"
		| "channels"
	>,
	label: string,
): SpeechEnhancerStageType => {
	if (!config.denoiseEnabled) return passthroughStage
	const engine = getSpeechEnhancerEngine(config.denoiseEngine)
	if (!engine) {
		warnOnce(
			`engine:${config.denoiseEngine}`,
			"🔇 denoise engine unknown — capture runs raw",
			{ engine: config.denoiseEngine, label },
		)
		return passthroughStage
	}
	if (
		config.sampleRate !== engine.capabilities.sampleRate ||
		config.channels !== 1
	) {
		warnOnce(
			`format:${config.sampleRate}:${config.channels}`,
			"🔇 denoise needs mono capture at the engine sample rate — capture runs raw",
			{
				engine: engine.id,
				required: engine.capabilities.sampleRate,
				sampleRate: config.sampleRate,
				channels: config.channels,
				label,
			},
		)
		return passthroughStage
	}
	if (!engine.available(config.denoiseModelPath)) {
		warnOnce(
			`model:${config.denoiseModelPath}`,
			"🔇 denoise model missing — capture runs raw",
			{
				engine: engine.id,
				modelPath: config.denoiseModelPath,
				hint: `npm run setup:models:${engine.id.toLowerCase()}`,
				label,
			},
		)
		return passthroughStage
	}
	try {
		const stage = engine.createStage({
			modelPath: config.denoiseModelPath,
			numThreads: config.denoiseNumThreads,
			provider: config.denoiseProvider,
		})
		audioCaptureLogger.info("🎚️ denoise stage active", {
			engine: engine.id,
			label,
		})
		return stage
	} catch (err) {
		warnOnce(
			`create:${config.denoiseModelPath}`,
			"🔇 denoise stage failed to start — capture runs raw",
			{ err, engine: engine.id, label },
		)
		return passthroughStage
	}
}
