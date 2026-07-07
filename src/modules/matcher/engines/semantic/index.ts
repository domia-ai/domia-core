import type { SkillToolType } from "@/db"
import type { DomiaType } from "@/modules/core"
import { embed, embedSpaceKey } from "@/modules/embeddings"

import type { ScoredToolType } from "../../types"

const toolText = (t: SkillToolType): string =>
	t.description ? `${t.rawName}: ${t.description}` : t.rawName

const cosine = (a: number[], b: number[]): number => {
	let dot = 0
	let na = 0
	let nb = 0
	const len = Math.min(a.length, b.length)
	for (let i = 0; i < len; i++) {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	const denom = Math.sqrt(na) * Math.sqrt(nb)
	return denom === 0 ? 0 : dot / denom
}

const toolEmbedCache = new Map<string, number[][]>()

const toolEmbeddingsFor = async (
	domia: DomiaType,
	tools: SkillToolType[],
): Promise<number[][] | null> => {
	const key = `${embedSpaceKey(domia)}§${tools.map(toolText).join("§")}`
	const cached = toolEmbedCache.get(key)
	if (cached) return cached
	const vectors = await embed(
		domia,
		tools.map((t) => toolText(t)),
	)
	if (!vectors) return null
	if (toolEmbedCache.size > 32) toolEmbedCache.clear()
	toolEmbedCache.set(key, vectors)
	return vectors
}

export const semanticRank = async (
	domia: DomiaType,
	utterance: string,
	tools: SkillToolType[],
	threshold: number,
): Promise<ScoredToolType[]> => {
	const [toolVecs, queryVecs] = await Promise.all([
		toolEmbeddingsFor(domia, tools),
		embed(domia, [utterance]),
	])
	const query = queryVecs?.[0]
	if (!toolVecs || !query)
		return tools.map((tool, index) => ({ tool, index, score: 0 }))
	return tools
		.map((tool, index) => {
			const sim = cosine(query, toolVecs[index] ?? [])
			return { tool, index, score: sim >= threshold ? sim : 0 }
		})
		.sort((a, b) => b.score - a.score || a.index - b.index)
}
