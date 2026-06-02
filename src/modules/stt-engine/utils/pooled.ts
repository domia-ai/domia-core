import path from "path"

import { type DomiaType } from "@/modules/core"
import { STT_ERRORS, sttEngineLogger, domiaError } from "@/utils"
import { type SelectSttConfigType } from "@/db"
import { getSttPool } from "./pool"
import type { SttWorkerEngineConfigType, SttWorkerResultType } from "../types"

const STT_SAMPLE_RATE = 16000

const requireSttConfig = (domia: DomiaType): SelectSttConfigType => {
	const sttConfig = domia?.sttConfig
	if (!sttConfig || !sttConfig.modelPath) {
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
			meta: {
				message: "STT requires sttConfig.modelPath (model directory)",
				modelPath: sttConfig?.modelPath,
			},
		})
	}
	return sttConfig
}

const engineConfigOf = (
	sttConfig: SelectSttConfigType,
): SttWorkerEngineConfigType => ({
	engine: sttConfig.engine,
	modelPath: path.resolve(sttConfig.modelPath),
	modelName: sttConfig.modelName ?? null,
	quantization: sttConfig.quantization ?? null,
	numThreads: sttConfig.numThreads,
	provider: sttConfig.provider,
	decodePaddingMs: sttConfig.decodePaddingMs,
	enableEndpoint: sttConfig.enableEndpoint,
	rule1MinTrailingSilence: sttConfig.rule1MinTrailingSilence,
	rule2MinTrailingSilence: sttConfig.rule2MinTrailingSilence,
	rule3MinUtteranceLength: sttConfig.rule3MinUtteranceLength,
})

export const runSttPooled = async (
	domia: DomiaType,
	filePath: string,
): Promise<string> => {
	const sttConfig = requireSttConfig(domia)
	const pool = getSttPool(sttConfig)
	const result = await pool.submit<SttWorkerResultType>({
		kind: "file",
		engineConfig: engineConfigOf(sttConfig),
		wavPath: filePath,
	})
	return result.text
}

export const runSttStreamPooled = async (
	domia: DomiaType,
	audioStream: AsyncIterable<Buffer>,
): Promise<string> => {
	const sttConfig = requireSttConfig(domia)
	const pool = getSttPool(sttConfig)
	const chunks: Buffer[] = []
	for await (const chunk of audioStream) {
		if (chunk.length > 0) chunks.push(Buffer.from(chunk))
	}
	const pcm = Buffer.concat(chunks)
	if (pcm.length === 0) return ""
	const result = await pool.submit<SttWorkerResultType>({
		kind: "pcm",
		engineConfig: engineConfigOf(sttConfig),
		pcm,
		sampleRate: STT_SAMPLE_RATE,
	})
	return result.text
}
