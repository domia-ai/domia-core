import { DEFAULT_OLLAMA_HOST } from "@/db"
import type { DomiaType } from "@/modules/core"

import type { LlmProbeResultType } from "../../types"
import { resolveKeepAlive, resolveOptions } from "."

const jsonHeaders = { "content-type": "application/json" }

export const probeOllama = async (
	domia: DomiaType,
	timeoutMs: number,
): Promise<LlmProbeResultType> => {
	const host = (domia.llmModelConfig?.baseUrl.trim() || DEFAULT_OLLAMA_HOST)
		.trim()
		.replace(/\/$/, "")
	const tags = await fetch(`${host}/api/tags`, {
		signal: AbortSignal.timeout(timeoutMs),
	})
	if (!tags.ok) return { ok: false, reason: `GET /api/tags → ${tags.status}` }
	const model = domia.llmModelConfig?.modelName
	if (!model) return { ok: true }
	const generated = await fetch(`${host}/api/generate`, {
		method: "POST",
		headers: jsonHeaders,
		body: JSON.stringify({
			model,
			prompt: "ok",
			stream: false,
			keep_alive: resolveKeepAlive(domia),
			options: { ...resolveOptions(domia), num_predict: 1 },
		}),
		signal: AbortSignal.timeout(timeoutMs),
	})
	if (!generated.ok)
		return { ok: false, reason: `POST /api/generate → ${generated.status}` }
	return { ok: true }
}
