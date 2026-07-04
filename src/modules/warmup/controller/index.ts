import { rm } from "fs/promises"

import { type DomiaType } from "@/modules/core"
import { warmupLogger } from "@/utils"
import { runTTS } from "@/modules/tts-engine"
import { runSttPcmPooled } from "@/modules/stt-engine"
import { warmTurnDetector } from "@/modules/turn-detector"
import { warmupLLM } from "@/modules/llm-engine"
import type { RuntimeCapabilitiesType } from "@/setups/environment"

const STT_SAMPLE_RATE = 16000
const STT_WARM_SILENCE = Buffer.alloc(STT_SAMPLE_RATE * 2)
const TTS_WARM_TEXT = "Ready when you are."
const ONNX_WARM_PASSES = 2

const timed = async (
	label: string,
	fn: () => Promise<unknown>,
): Promise<void> => {
	const start = Date.now()
	try {
		await fn()
		warmupLogger.info(`🔥 warmup ${label} ready in ${Date.now() - start}ms`)
	} catch (err) {
		warmupLogger.warn(`⚠️ warmup ${label} failed (cold first turn)`, { err })
	}
}

const warmStt = (domia: DomiaType): Promise<void> =>
	timed("STT", async () => {
		for (let i = 0; i < ONNX_WARM_PASSES; i++) {
			await runSttPcmPooled(domia, STT_WARM_SILENCE)
		}
	})

const warmTts = (domia: DomiaType): Promise<void> =>
	timed("TTS", async () => {
		for (let i = 0; i < ONNX_WARM_PASSES; i++) {
			const { filePath } = await runTTS(domia, TTS_WARM_TEXT)
			if (filePath) await rm(filePath, { force: true }).catch(() => undefined)
		}
	})

const warmLlm = (domia: DomiaType): Promise<void> =>
	timed("LLM", () => warmupLLM(domia))

export const warmupOnBoot = (
	domia: DomiaType,
	capabilities: RuntimeCapabilitiesType,
): void => {
	if (!domia.warmupOnBoot) return
	const tasks: Promise<void>[] = []
	if (capabilities.stt && domia.sttConfig?.modelPath) tasks.push(warmStt(domia))
	if (capabilities.llm && domia.llmModelConfig?.modelName)
		tasks.push(warmLlm(domia))
	if (capabilities.tts && domia.ttsConfig?.modelPath) tasks.push(warmTts(domia))
	if (domia.wakeWordConfig?.acousticEndpointingEnabled)
		warmTurnDetector(domia.wakeWordConfig.turnDetectorModelPath)
	if (tasks.length === 0) return
	warmupLogger.info(`🔥 warming local models (${tasks.length} stages)`)
	void Promise.allSettled(tasks).then(() =>
		warmupLogger.info(`🔥 warmup complete — first turn is hot`),
	)
}
