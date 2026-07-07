import {
	DEFAULT_EMBED_BACKEND,
	DEFAULT_EMBED_MODEL_PATH,
	EMBED_BACKEND_ENUM,
} from "@/db"
import {
	type DomiaType,
	resolveEmbedModel,
	resolveOllamaHost,
} from "@/modules/core"

import { getEmbedBackend } from "../backends/backends"
import { transformersEmbedBackend } from "../backends/transformers"

export const embedSpaceKey = (domia: DomiaType): string => {
	const kind = domia.llmModelConfig?.embedBackend ?? DEFAULT_EMBED_BACKEND
	if (kind === EMBED_BACKEND_ENUM.OLLAMA)
		return `ollama|${resolveOllamaHost(domia)}|${resolveEmbedModel(domia)}`
	return `transformers|${domia.llmModelConfig?.embedModelPath ?? DEFAULT_EMBED_MODEL_PATH}`
}

export const embed = async (
	domia: DomiaType,
	texts: string[],
): Promise<number[][] | null> => {
	const kind = domia.llmModelConfig?.embedBackend ?? DEFAULT_EMBED_BACKEND
	const backend = getEmbedBackend(kind) ?? transformersEmbedBackend
	return await backend.embed(domia, texts)
}
