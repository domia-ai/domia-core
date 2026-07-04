import {
	type DomiaType,
	resolveEmbedModel,
	resolveOllamaHost,
} from "@/modules/core"
import { intentRouterLogger } from "@/utils"
import type { IntentToolHintType } from "../types"

const embedCache = new Map<string, number[][]>()

const EMBED_TIMEOUT_MS = 3000

export const embedTexts = async (
	domia: DomiaType,
	texts: string[],
): Promise<number[][] | null> => {
	try {
		const res = await fetch(`${resolveOllamaHost(domia)}/api/embed`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model: resolveEmbedModel(domia), input: texts }),
			signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
		})
		if (!res.ok) return null
		const json = (await res.json()) as { embeddings?: number[][] }
		return json.embeddings ?? null
	} catch (err) {
		intentRouterLogger.warn("embed request failed", { err })
		return null
	}
}

export const cosine = (a: number[], b: number[]): number => {
	let dot = 0
	let na = 0
	let nb = 0
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	const denom = Math.sqrt(na) * Math.sqrt(nb)
	return denom === 0 ? 0 : dot / denom
}

const toolText = (t: IntentToolHintType): string =>
	t.description ? `${t.name}: ${t.description}` : t.name

export const toolEmbeddings = async (
	domia: DomiaType,
	tools: IntentToolHintType[],
): Promise<number[][] | null> => {
	const key = `${resolveOllamaHost(domia)}|${resolveEmbedModel(domia)}|${tools.map(toolText).join("§")}`
	const cached = embedCache.get(key)
	if (cached) return cached
	const vectors = await embedTexts(
		domia,
		tools.map((t) => toolText(t)),
	)
	if (!vectors) return null
	if (embedCache.size > 32) embedCache.clear()
	embedCache.set(key, vectors)
	intentRouterLogger.info(`intent tool embeddings cached (${tools.length})`, {
		domiaId: domia.id,
	})
	return vectors
}

const KEYPHRASE_MIN_LEN = 4

const escapeRegExp = (s: string): string =>
	s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const keyphraseHit = (
	transcript: string,
	tools: IntentToolHintType[],
): string | null => {
	const t = transcript.toLowerCase()
	for (const tool of tools) {
		const words = tool.name
			.toLowerCase()
			.split(/[_\-.\s]+/)
			.filter((w) => w.length >= KEYPHRASE_MIN_LEN)
		if (
			words.length > 0 &&
			words.every((w) => new RegExp(`\\b${escapeRegExp(w)}`).test(t))
		)
			return tool.name
	}
	return null
}
