import { domiaBusLogger, languageSetsFor } from "@/utils"
import {
	DEFAULT_TOOL_SHORTLIST_MAX,
	DEFAULT_TOOL_SHORTLIST_RANKED_RESERVE,
	DEFAULT_SPECULATION_SKILL_GATE_MAX_SCORE,
	type SkillToolType,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import {
	shortlistTools,
	buildToolManifest,
	toolBaseName,
	toolProviderSlug,
	getConnectionsFor,
	toolAvailableFor,
	getToolPolicy,
	getToolMeta,
	type OriginCapabilitiesType,
	type ToolManifestType,
} from "@/modules/skill-engine"
import { rankTools, getMatcherEngine } from "@/modules/matcher"
import type { IntentToolHintType } from "@/modules/intent-router"
import type { JudgeCatalogType } from "../types"

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

export const judgeableToolsOf = (domia: DomiaType): SkillToolType[] =>
	[...advertisedToolsOf(domia)].sort((a, b) =>
		a.namespacedName.localeCompare(b.namespacedName),
	)

const JUDGE_NAME_QUALIFIER = ":"

export const judgeCatalogOf = (
	tools: SkillToolType[],
	toolExamples: Record<string, string[]>,
	toolLabels: Record<string, string> = {},
): JudgeCatalogType => {
	const shown = (t: SkillToolType): string =>
		toolLabels[t.namespacedName] ?? toolBaseName(t.rawName)
	const counts = new Map<string, number>()
	for (const t of tools) counts.set(shown(t), (counts.get(shown(t)) ?? 0) + 1)
	const byName = new Map<string, SkillToolType>()
	const hints: IntentToolHintType[] = []
	for (const t of tools) {
		const name =
			(counts.get(shown(t)) ?? 0) > 1
				? `${t.provider}${JUDGE_NAME_QUALIFIER}${shown(t)}`
				: shown(t)
		byName.set(name, t)
		hints.push({
			name,
			description: t.description,
			examples: toolExamples[t.namespacedName],
		})
	}
	return { hints, byName }
}

export const isReadTool = (domia: DomiaType, namespacedName: string): boolean =>
	getToolMeta(domia.id, namespacedName)?.riskClass === "read"

export const providerReadToolsOf = (
	domia: DomiaType,
	tools: SkillToolType[],
	namespacedName: string,
): SkillToolType[] => {
	const slug = toolProviderSlug(namespacedName)
	return tools.filter(
		(t) =>
			toolProviderSlug(t.namespacedName) === slug &&
			isReadTool(domia, t.namespacedName),
	)
}

export const withJudgedTool = (
	domia: DomiaType,
	tools: SkillToolType[],
	judged: SkillToolType | null,
	origin: OriginCapabilitiesType | null,
): SkillToolType[] =>
	!judged ||
	tools.some((t) => t.namespacedName === judged.namespacedName) ||
	(origin !== null &&
		!toolAvailableFor(domia.id, judged.namespacedName, origin))
		? tools
		: [...tools, judged]

export const expectedActionTools = (
	tools: SkillToolType[],
	named: string[],
): string[] => {
	const offered = new Set(tools.map((t) => t.namespacedName))
	return named.filter((name) => offered.has(name))
}

export const namedToolsOnly = (
	tools: SkillToolType[],
	named: string[],
): SkillToolType[] => {
	if (named.length === 0) return tools
	const wanted = new Set(named)
	return tools.filter((t) => wanted.has(t.namespacedName))
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

export const offerableToolsOf = (
	domia: DomiaType,
	origin: OriginCapabilitiesType | null,
): SkillToolType[] =>
	advertisedToolsOf(domia).filter(
		(t) =>
			getToolPolicy(domia.id, t.namespacedName) !== "block" &&
			(!origin || toolAvailableFor(domia.id, t.namespacedName, origin)),
	)

export const shortlistedToolsOf = async (
	domia: DomiaType,
	transcript: string,
	origin: OriginCapabilitiesType | null = null,
): Promise<SkillToolType[]> => {
	const manifest = toolManifestOf(domia)
	const available = offerableToolsOf(domia, origin)
	const scored = await rankTools(domia, transcript, available, {
		aliases: manifest.aliases,
	})
	const ranked = scored.filter(
		(r) => r.score > 0 || !manifest.builtinNames.has(r.tool.namespacedName),
	)
	const result = shortlistTools(
		ranked,
		domia.llmModelConfig?.toolShortlistMax ?? DEFAULT_TOOL_SHORTLIST_MAX,
		{
			coreNames: manifest.coreNames,
			rankedReserve: DEFAULT_TOOL_SHORTLIST_RANKED_RESERVE,
		},
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
