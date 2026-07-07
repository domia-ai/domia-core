import type { SkillToolType } from "@/db"
import type { ScoredToolType } from "@/modules/matcher"

import type {
	ToolShortlistResultType,
	ToolShortlistOptionsType,
} from "../types"

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

	const rankedTools = ranked.filter((r) => r.score > 0).map((r) => r.tool)
	const cap = Math.max(max, core.length)
	const seen = new Set<string>()
	const merged: SkillToolType[] = []
	for (const tool of [...core, ...rankedTools]) {
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
