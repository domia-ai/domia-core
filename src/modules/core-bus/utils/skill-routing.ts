import { domiaBusLogger, languageSetsFor } from "@/utils"
import {
	DEFAULT_TOOL_SHORTLIST_MAX,
	DEFAULT_SPECULATION_SKILL_GATE_MAX_SCORE,
	type SkillToolType,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import { shortlistTools, buildToolManifest } from "@/modules/skill-engine"
import { rankTools, getMatcherEngine } from "@/modules/matcher"

import type { CoreBusContextType } from "../types"

export const skillsEnabled = (ctx: CoreBusContextType): boolean =>
	ctx.domia.moduleSettings?.skillsEngine === true

export const cachedToolsOf = (domia: DomiaType): SkillToolType[] =>
	(domia.skillProviders ?? [])
		.filter((s) => s.isActive)
		.flatMap((s) => s.toolsCache ?? [])

export const skillsMayIntercept = (domia: DomiaType): boolean =>
	domia.moduleSettings?.skillsEngine === true &&
	(domia.skillProviders ?? []).some(
		(p) => p.isActive && (p.toolsCache?.length ?? 0) > 0,
	)

export const looksSkillish = async (
	domia: DomiaType,
	transcript: string,
): Promise<boolean> => {
	const tools = cachedToolsOf(domia)
	if (tools.length === 0) return false
	const lexical = getMatcherEngine("lexical")
	if (!lexical) return true
	const manifest = buildToolManifest(domia)
	const ranked = await lexical.rank(transcript, tools, {
		aliases: manifest.aliases,
		stopwords: languageSetsFor(domia.characterProfile?.language).stopwords,
	})
	const maxScore =
		domia.wakeWordConfig?.speculationSkillGateMaxScore ??
		DEFAULT_SPECULATION_SKILL_GATE_MAX_SCORE
	const top = ranked.length > 0 ? ranked[0].score : 0
	return top > maxScore
}

export const shortlistedToolsOf = async (
	domia: DomiaType,
	transcript: string,
): Promise<SkillToolType[]> => {
	const manifest = buildToolManifest(domia)
	const ranked = await rankTools(domia, transcript, cachedToolsOf(domia), {
		aliases: manifest.aliases,
	})
	const result = shortlistTools(
		ranked,
		domia.llmModelConfig?.toolShortlistMax ?? DEFAULT_TOOL_SHORTLIST_MAX,
		{ coreNames: manifest.coreNames },
	)
	if (result.applied) {
		domiaBusLogger.info(
			`🧰 tool shortlist ${result.tools.length}/${result.total} (dropped ${result.dropped})`,
			{ domiaId: domia.id },
		)
	}

	return [...result.tools].sort((a, b) =>
		a.namespacedName.localeCompare(b.namespacedName),
	)
}
