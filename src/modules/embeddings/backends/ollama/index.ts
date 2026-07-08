import { Ollama } from "ollama"
import { resolveEmbedModel, resolveOllamaHost } from "@/modules/core"
import { embeddingsLogger } from "@/utils"
import { EMBED_BACKEND_ENUM } from "@/db"

import type { EmbedBackendType } from "../../types"

const EMBED_TIMEOUT_MS = 3000

const timeoutFetch = ((input, init) =>
	fetch(input, {
		...init,
		signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
	})) as typeof fetch

export const ollamaEmbedBackend: EmbedBackendType = {
	id: EMBED_BACKEND_ENUM.OLLAMA,
	capabilities: { local: false, normalized: true },
	embed: async (domia, texts) => {
		if (!texts.length) return []
		try {
			const client = new Ollama({
				host: resolveOllamaHost(domia),
				fetch: timeoutFetch,
			})
			const res = await client.embed({
				model: resolveEmbedModel(domia),
				input: texts,
			})
			return res.embeddings ?? null
		} catch (err) {
			embeddingsLogger.warn("ollama embed failed", { err, domiaId: domia.id })
			return null
		}
	},
}
