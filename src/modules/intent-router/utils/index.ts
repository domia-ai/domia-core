import { type DomiaType } from "@/modules/core"
import { embed, embedSpaceKey } from "@/modules/embeddings"
import { getMatcherEngine } from "@/modules/matcher"
import { intentRouterLogger, languageSetsFor } from "@/utils"
import type { SkillToolType } from "@/db"
import type { IntentToolHintType } from "../types"

const embedCache = new Map<string, number[][]>()

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
	const key = `${embedSpaceKey(domia)}|${tools.map(toolText).join("§")}`
	const cached = embedCache.get(key)
	if (cached) return cached
	const vectors = await embed(
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

export const exampleEmbeddings = async (
	domia: DomiaType,
	utterances: string[],
): Promise<number[][] | null> => {
	if (utterances.length === 0) return null
	const key = `ex|${embedSpaceKey(domia)}|${utterances.join("§")}`
	const cached = embedCache.get(key)
	if (cached) return cached
	const vectors = await embed(domia, utterances)
	if (!vectors) return null
	if (embedCache.size > 32) embedCache.clear()
	embedCache.set(key, vectors)
	return vectors
}

export const keywordHit = (
	transcript: string,
	keywords: string[],
): string | null => {
	const t = transcript.toLowerCase()
	for (const kw of keywords) {
		const w = kw.trim().toLowerCase()
		if (
			w.length >= KEYPHRASE_MIN_LEN &&
			new RegExp(`\\b${escapeRegExp(w)}`).test(t)
		)
			return kw
	}
	return null
}

export const lexicalToolScore = async (
	domia: DomiaType,
	transcript: string,
	tools: IntentToolHintType[],
): Promise<number> => {
	const lexical = getMatcherEngine("lexical")
	if (!lexical || tools.length === 0) return 0
	const shaped: SkillToolType[] = tools.map((t) => ({
		provider: "",
		rawName: t.name,
		namespacedName: t.name,
		description: t.description,
		inputSchema: {},
	}))
	const ranked = await lexical.rank(transcript, shaped, {
		stopwords: languageSetsFor(domia.characterProfile?.language).stopwords,
	})
	return ranked.length > 0 ? ranked[0].score : 0
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
