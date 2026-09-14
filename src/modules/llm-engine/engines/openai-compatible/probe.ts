import type { DomiaType } from "@/modules/core"

import type { LlmProbeResultType } from "../../types"
import { isLlamaServer, llamaServerUrl, resolveConfig } from "./client"
import { LLAMA_HEALTH_PATH } from "./constants"

const probeLlamaHealth = async (
	baseUrl: string,
	timeoutMs: number,
): Promise<LlmProbeResultType> => {
	const health = await fetch(llamaServerUrl(baseUrl, LLAMA_HEALTH_PATH), {
		signal: AbortSignal.timeout(timeoutMs),
	})
	if (!health.ok)
		return { ok: false, reason: `GET ${LLAMA_HEALTH_PATH} → ${health.status}` }
	return { ok: true }
}

export const probeOpenAiCompatible = async (
	domia: DomiaType,
	timeoutMs: number,
): Promise<LlmProbeResultType> => {
	const config = domia.llmModelConfig
	const baseUrl = config?.baseUrl.trim().replace(/\/$/, "")
	if (!baseUrl)
		return { ok: false, reason: "openai-compatible LLM requires llm.baseUrl" }
	const headers: Record<string, string> = { "content-type": "application/json" }
	if (config?.apiKey?.trim())
		headers.authorization = `Bearer ${config.apiKey.trim()}`
	const models = await fetch(`${baseUrl}/models`, {
		headers,
		signal: AbortSignal.timeout(timeoutMs),
	})
	if (!models.ok) return { ok: false, reason: `GET /models → ${models.status}` }
	if (await isLlamaServer(resolveConfig(domia)))
		return probeLlamaHealth(baseUrl, timeoutMs)
	const completion = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: config?.modelName ?? "",
			messages: [{ role: "user", content: "ok" }],
			max_tokens: 1,
			stream: false,
		}),
		signal: AbortSignal.timeout(timeoutMs),
	})
	if (!completion.ok)
		return {
			ok: false,
			reason: `POST /chat/completions → ${completion.status}`,
		}
	return { ok: true }
}
