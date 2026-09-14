import { LLM_ENGINE_ENUM, type LlmEngineEnumType } from "@/db"
import type { DomiaType } from "@/modules/core"
import { LLM_ERRORS, domiaError, llmEngineLogger, toError } from "@/utils"

import { probeOllama } from "./ollama/probe"
import { probeOpenAiCompatible } from "./openai-compatible/probe"
import type { LlmProbeType } from "../types"

const LLM_PROBE_TIMEOUT_MS = 15_000

export const llmProbeRegistry: Record<LlmEngineEnumType, LlmProbeType> = {
	[LLM_ENGINE_ENUM.OLLAMA]: probeOllama,
	[LLM_ENGINE_ENUM.OPENAI_COMPATIBLE]: probeOpenAiCompatible,
}

export const probeLlmEngine = async (domia: DomiaType): Promise<void> => {
	const engine = domia.llmModelConfig?.engine
	const probe = engine ? llmProbeRegistry[engine] : undefined
	if (!probe)
		throw domiaError(LLM_ERRORS.LLM_ENGINE_NOT_FOUND, {
			logger: llmEngineLogger,
			meta: { engine },
		})
	const result = await probe(domia, LLM_PROBE_TIMEOUT_MS).catch(
		(err: unknown) => ({ ok: false as const, reason: toError(err).message }),
	)
	if (!result.ok)
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: {
				engine,
				baseUrl: domia.llmModelConfig?.baseUrl,
				model: domia.llmModelConfig?.modelName,
				reason: result.reason,
			},
		})
}
