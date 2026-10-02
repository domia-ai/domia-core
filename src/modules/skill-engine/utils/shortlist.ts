import type { SkillToolType } from "@/db"
import type { ScoredToolType } from "@/modules/matcher"

import type {
	ToolShortlistResultType,
	ToolShortlistOptionsType,
} from "../types"

const keptCore = (
	ranked: ScoredToolType[],
	core: SkillToolType[],
	cap: number,
	reserve: number,
): { reserved: SkillToolType[]; core: SkillToolType[] } => {
	const free = cap - core.length
	if (reserve <= free) return { reserved: [], core }
	const coreNames = new Set(core.map((t) => t.namespacedName))
	const weakestFirst = ranked
		.filter((r) => coreNames.has(r.tool.namespacedName))
		.sort((a, b) => a.score - b.score || b.index - a.index)
	const challengers = ranked
		.filter((r) => r.score > 0 && !coreNames.has(r.tool.namespacedName))
		.slice(0, reserve)
	const displaced = new Set<string>()
	const reserved = challengers.filter((challenger, i) => {
		if (i < free) return true
		const weakest = weakestFirst.at(i - free)
		if (!weakest || weakest.score >= challenger.score) return false
		displaced.add(weakest.tool.namespacedName)
		return true
	})
	return {
		reserved: reserved.map((r) => r.tool),
		core: core.filter((t) => !displaced.has(t.namespacedName)),
	}
}

export const shortlistTools = (
	ranked: ScoredToolType[],
	max: number,
	opts: ToolShortlistOptionsType = {},
): ToolShortlistResultType => {
	const total = ranked.length
	if (max <= 0)
		return {
			tools: ranked.map((r) => r.tool),
			total,
			dropped: 0,
			applied: false,
		}
	const confMin = opts.confMin ?? 0
	const core = opts.coreNames?.size
		? ranked
				.filter((r) => opts.coreNames?.has(r.tool.namespacedName))
				.sort((a, b) => a.index - b.index)
				.map((r) => r.tool)
		: []
	const maxScore = ranked.length ? ranked[0].score : 0

	if (maxScore <= 0 || maxScore < confMin) {
		return {
			tools: core,
			total,
			dropped: total - core.length,
			applied: true,
		}
	}

	const cap = Math.max(max, core.length)
	const kept = keptCore(ranked, core, cap, opts.rankedReserve ?? 0)
	const rankedTools = ranked.filter((r) => r.score > 0).map((r) => r.tool)
	const seen = new Set<string>()
	const merged: SkillToolType[] = []
	for (const tool of [...kept.reserved, ...kept.core, ...rankedTools]) {
		if (seen.has(tool.namespacedName)) continue
		seen.add(tool.namespacedName)
		merged.push(tool)
		if (merged.length >= cap) break
	}
	return {
		tools: merged,
		total,
		dropped: total - merged.length,
		applied: merged.length < total,
	}
}
