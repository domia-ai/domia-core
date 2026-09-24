import { domiaBusLogger, languageSetsFor } from "@/utils"
import {
	DEFAULT_TOOL_SHORTLIST_MAX,
	DEFAULT_SPECULATION_SKILL_GATE_MAX_SCORE,
	type SkillToolType,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import {
	shortlistTools,
	buildToolManifest,
	toolBaseName,
	getConnectionsFor,
	toolAvailableFor,
	getToolPolicy,
	type OriginCapabilitiesType,
	type ToolManifestType,
} from "@/modules/skill-engine"
import { rankTools, getMatcherEngine } from "@/modules/matcher"

export const hasSkillConnections = (domia: DomiaType): boolean =>
	getConnectionsFor(domia.id).length > 0

const connectedProviderIds = (domia: DomiaType): ReadonlySet<string> =>
	new Set(getConnectionsFor(domia.id).map((c) => c.providerId))

export const toolManifestOf = (domia: DomiaType): ToolManifestType =>
	buildToolManifest(domia, connectedProviderIds(domia))

const advertisedToolsOf = (domia: DomiaType): SkillToolType[] => {
	const hidden = toolManifestOf(domia).hiddenNames
	return cachedToolsOf(domia).filter((t) => !hidden.has(t.namespacedName))
}

export const cachedToolsOf = (domia: DomiaType): SkillToolType[] => {
	const connected = connectedProviderIds(domia)
	return (domia.skillProviders ?? [])
		.filter((s) => s.isActive && connected.has(s.id))
		.flatMap((s) => s.toolsCache ?? [])
}

export const skillsMayIntercept = (domia: DomiaType): boolean =>
	getConnectionsFor(domia.id).some((c) => c.allowedTools.size > 0)

export const looksSkillish = async (
	domia: DomiaType,
	transcript: string,
): Promise<boolean> => {
	const tools = cachedToolsOf(domia)
	if (tools.length === 0) return false
	const lexical = getMatcherEngine("lexical")
	if (!lexical) return true
	const manifest = toolManifestOf(domia)
	const ranked = await lexical.rank(transcript, tools, {
		aliases: manifest.aliases,
		stopwords: languageSetsFor(domia.characterProfile?.language).stopwords,
	})
	const maxScore =
		domia.wakeWordConfig?.speculationSkillGateMaxScore ??
		DEFAULT_SPECULATION_SKILL_GATE_MAX_SCORE
	const top = ranked.length > 0 ? ranked[0].score : 0
	domiaBusLogger.debug("🔮 speculation skill gate", {
		domiaId: domia.id,
		top,
		maxScore,
		blocked: top > maxScore,
	})
	return top > maxScore
}

export const shortlistedToolsOf = async (
	domia: DomiaType,
	transcript: string,
	origin: OriginCapabilitiesType | null = null,
): Promise<SkillToolType[]> => {
	const manifest = toolManifestOf(domia)
	const available = advertisedToolsOf(domia).filter(
		(t) =>
			getToolPolicy(domia.id, t.namespacedName) !== "block" &&
			(!origin || toolAvailableFor(domia.id, t.namespacedName, origin)),
	)
	const scored = await rankTools(domia, transcript, available, {
		aliases: manifest.aliases,
	})
	const ranked = scored.filter(
		(r) => r.score > 0 || !manifest.builtinNames.has(r.tool.namespacedName),
	)
	const result = shortlistTools(
		ranked,
		domia.llmModelConfig?.toolShortlistMax ?? DEFAULT_TOOL_SHORTLIST_MAX,
		{ coreNames: manifest.coreNames },
	)
	if (result.applied) {
		domiaBusLogger.info(
			`🧰 tool shortlist ${result.tools.length}/${result.total} (dropped ${result.dropped})`,
			{
				domiaId: domia.id,
				kept: result.tools.map((t) => toolBaseName(t.namespacedName)),
				core: [...manifest.coreNames],
			},
		)
	}

	return [...result.tools].sort((a, b) =>
		a.namespacedName.localeCompare(b.namespacedName),
	)
}
