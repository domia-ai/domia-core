import { DEFAULT_EMBEDDING_MODEL, DEFAULT_OLLAMA_HOST } from "@/db"
import type { DomiaType } from "../types"

export const resolveOllamaHost = (domia: DomiaType): string =>
	domia.llmModelConfig?.baseUrl?.trim() || DEFAULT_OLLAMA_HOST

export const resolveEmbedModel = (domia: DomiaType): string =>
	domia.llmModelConfig?.embeddingModelName?.trim() || DEFAULT_EMBEDDING_MODEL
