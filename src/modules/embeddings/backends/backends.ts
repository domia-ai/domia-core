import { EMBED_BACKEND_ENUM, type EmbedBackendEnumType } from "@/db"
import { transformersEmbedBackend } from "./transformers"
import { ollamaEmbedBackend } from "./ollama"
import type { EmbedBackendType } from "../types"

export const embedBackendRegistry: Record<
	EmbedBackendEnumType,
	EmbedBackendType
> = {
	[EMBED_BACKEND_ENUM.TRANSFORMERS]: transformersEmbedBackend,
	[EMBED_BACKEND_ENUM.OLLAMA]: ollamaEmbedBackend,
}

export const getEmbedBackend = (
	id: EmbedBackendEnumType,
): EmbedBackendType | null => embedBackendRegistry[id] ?? null
