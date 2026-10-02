import type {
	DomiaSkillDescriptorType,
	FastPathIntentType,
	SelectRoutineType,
	SelectSkillProviderType,
	ToolFinalizeMapType,
	ToolHintOverrideType,
	ToolPolicyType,
} from "@/db"
import {
	languageSetsFor,
	skillEngineLogger,
	type LanguageCatalogExtensionType,
} from "@/utils"
import {
	hasSpokenDuration,
	numberSetsOf,
	spokenClocksIn,
} from "@/modules/fast-path/utils/match"

import { runtimePortOrNull } from "../../controller/hooks"
import type {
	BuiltinToolType,
	SkillSpecializationType,
	ToolTargetInferenceType,
} from "../../types"
import {
	DOMIA_ARG_CLOCK,
	DOMIA_ARG_DELAY,
	DOMIA_CLOCK_RE,
	DOMIA_SPECIALIZATION_KIND,
} from "./constants"
import { fillPlaceholders, packFor } from "./packs"
import {
	activeRoutinesOf,
	routineAvailableFor,
	routineFinalizeOf,
	routineForTool,
	routineHintOf,
	routineIntentOf,
	routinePolicyOf,
	routineToolName,
} from "./routines"
import { DOMIA_TOOLS } from "./tools"
import type { DomiaRoutineBlocksType, DomiaToolPackEntryType } from "./types"

const entriesFor = (
	available: Set<string>,
	language: string | null,
): DomiaToolPackEntryType[] =>
	DOMIA_TOOLS.filter((tool) => available.has(tool.name)).map((tool) => ({
		tool,
		pack: packFor(tool, language),
	}))

const routinesFor = (
	available: Set<string>,
	provider: SelectSkillProviderType | undefined,
): SelectRoutineType[] =>
	provider
		? activeRoutinesOf(provider.domiaId).filter((routine) =>
				available.has(routineToolName(routine.slug)),
			)
		: []

const unique = (lists: (string[] | undefined)[]): string[] => [
	...new Set(lists.flatMap((list) => list ?? [])),
]

const hintsOf = (
	entries: DomiaToolPackEntryType[],
): Record<string, ToolHintOverrideType> =>
	Object.fromEntries(
		entries.flatMap(({ tool }) => {
			const a = tool.definition.annotations
			if (!a) return []
			const hint: ToolHintOverrideType = {}
			if (a.readOnlyHint !== undefined) hint.readOnlyHint = a.readOnlyHint
			if (a.destructiveHint !== undefined)
				hint.destructiveHint = a.destructiveHint
			if (a.idempotentHint !== undefined) hint.idempotentHint = a.idempotentHint
			if (a.openWorldHint !== undefined) hint.openWorldHint = a.openWorldHint
			return [[tool.name, hint]]
		}),
	)

const policiesOf = (
	entries: DomiaToolPackEntryType[],
): Record<string, ToolPolicyType> =>
	Object.fromEntries(
		entries.flatMap(({ tool }) =>
			tool.policy ? [[tool.name, tool.policy]] : [],
		),
	)

const finalizeOf = (entries: DomiaToolPackEntryType[]): ToolFinalizeMapType =>
	Object.fromEntries(
		entries.map(({ tool, pack }) => [tool.name, pack.finalize]),
	)

const intentsOf = (entries: DomiaToolPackEntryType[]): FastPathIntentType[] =>
	entries.flatMap(({ tool, pack }) =>
		(pack.intents ?? []).map((intent) => ({ ...intent, tool: tool.name })),
	)

const expansionRulesOf = (
	entries: DomiaToolPackEntryType[],
): Record<string, string> =>
	entries.reduce<Record<string, string>>(
		(acc, { pack }) => ({ ...acc, ...(pack.expansionRules ?? {}) }),
		{},
	)

const routineBlocks = (
	routines: SelectRoutineType[],
	language: string | null,
	domiaId: string | null,
): DomiaRoutineBlocksType => ({
	aliases: Object.fromEntries(
		routines.map((r) => [routineToolName(r.slug), [r.name]]),
	),
	toolHints: Object.fromEntries(
		routines.map((r) => [
			routineToolName(r.slug),
			domiaId ? routineHintOf(domiaId, r) : {},
		]),
	),
	toolPolicy: Object.fromEntries(
		routines.map((r) => [
			routineToolName(r.slug),
			domiaId ? routinePolicyOf(domiaId, r) : "block",
		]),
	),
	finalize: Object.fromEntries(
		routines.map((r) => [
			routineToolName(r.slug),
			routineFinalizeOf(r, language),
		]),
	),
	intents: routines.flatMap((r) => routineIntentOf(r, language) ?? []),
})

const catalogExtensions = (): Record<string, LanguageCatalogExtensionType> => {
	const phrasesByLanguage = new Map<string, Record<string, string>>()
	for (const tool of DOMIA_TOOLS)
		for (const [language, pack] of Object.entries(tool.packs))
			if (pack.phrases)
				phrasesByLanguage.set(language, {
					...(phrasesByLanguage.get(language) ?? {}),
					...pack.phrases,
				})
	return Object.fromEntries(
		[...phrasesByLanguage].map(([language, phrases]) => [
			language,
			{ phrases },
		]),
	)
}

const builtinTool = (rawName: string): BuiltinToolType | undefined =>
	DOMIA_TOOLS.find((t) => t.name === rawName)

const propertiesOf = (tool: BuiltinToolType): Record<string, unknown> => {
	const properties = tool.definition.inputSchema?.properties
	return properties && typeof properties === "object"
		? (properties as Record<string, unknown>)
		: {}
}

const requiredOf = (tool: BuiltinToolType): string[] => {
	const required = tool.definition.inputSchema?.required
	return Array.isArray(required) ? required.map(String) : []
}

const withoutInvalidOptionals = (
	tool: BuiltinToolType,
	args: Record<string, unknown>,
): Record<string, unknown> => {
	const parsed = tool.schema.safeParse(args)
	if (parsed.success) return args
	const required = new Set(requiredOf(tool))
	const invalid = new Set(
		parsed.error.issues
			.map((issue) => issue.path[0])
			.filter(
				(key): key is string => typeof key === "string" && !required.has(key),
			),
	)
	if (invalid.size === 0) return args
	const kept = Object.fromEntries(
		Object.entries(args).filter(([key]) => !invalid.has(key)),
	)
	if (!tool.schema.safeParse(kept).success) return args
	skillEngineLogger.info("built-in tool optional arguments dropped", {
		tool: tool.name,
		dropped: [...invalid],
	})
	return kept
}

const spokenTimeFor = (
	tool: BuiltinToolType,
	args: Record<string, unknown>,
	transcript: string,
	language: string | null,
): ToolTargetInferenceType => {
	const properties = propertiesOf(tool)
	const takesClock = Object.hasOwn(properties, DOMIA_ARG_CLOCK)
	const givesTime =
		args[DOMIA_ARG_CLOCK] !== undefined || args[DOMIA_ARG_DELAY] !== undefined
	if (!givesTime) return { kind: "targeted" }
	const numbers = numberSetsOf(languageSetsFor(language))
	const clocks = takesClock ? spokenClocksIn(transcript, numbers) : []
	const delaySpoken = hasSpokenDuration(transcript, numbers)
	if (clocks.length === 0 && !delaySpoken)
		return { kind: "untargeted", missing: "time" }
	if (clocks.length !== 1 || delaySpoken) return { kind: "targeted" }
	const [spoken] = clocks
	const given = args[DOMIA_ARG_CLOCK]
	const valid = typeof given === "string" && DOMIA_CLOCK_RE.test(given)
	return {
		kind: "inferred",
		args: {
			[DOMIA_ARG_CLOCK]: valid && !spoken.qualified ? given : spoken.value,
			[DOMIA_ARG_DELAY]: undefined,
		},
	}
}

export const domiaSpecialization: SkillSpecializationType = {
	kind: DOMIA_SPECIALIZATION_KIND,
	catalogExtensions: catalogExtensions(),
	descriptorDefaults: (tools, language, provider): DomiaSkillDescriptorType => {
		const available = new Set(tools.map((t) => t.rawName))
		const entries = entriesFor(available, language)
		const routines = routineBlocks(
			routinesFor(available, provider),
			language,
			provider?.domiaId ?? null,
		)
		const intents = [...intentsOf(entries), ...routines.intents]
		const routed = entries.filter(({ tool }) => !tool.hiddenFromLlm)
		return {
			version: 1,
			kind: DOMIA_SPECIALIZATION_KIND,
			routing: {
				aliases: {
					...Object.fromEntries(
						routed
							.filter(({ pack }) => (pack.keywords ?? []).length > 0)
							.map(({ tool, pack }) => [tool.name, pack.keywords ?? []]),
					),
					...routines.aliases,
				},
				keywords: unique(routed.map(({ pack }) => pack.keywords)),
				exampleUtterances: unique(
					routed.map(({ pack }) => pack.exampleUtterances),
				),
			},
			execution: {
				hiddenTools: entries
					.filter(({ tool }) => tool.hiddenFromLlm)
					.map(({ tool }) => tool.name),
				toolHints: { ...hintsOf(entries), ...routines.toolHints },
				toolPolicy: { ...policiesOf(entries), ...routines.toolPolicy },
				finalize: { ...finalizeOf(entries), ...routines.finalize },
			},
			...(intents.length > 0
				? {
						fastPath: {
							intents,
							expansionRules: expansionRulesOf(entries),
						},
					}
				: {}),
		}
	},
	toolAvailability: (provider, rawName, origin) => {
		const routine = routineForTool(provider.domiaId, rawName)
		if (routine) return routineAvailableFor(provider.domiaId, routine, origin)
		const tool = DOMIA_TOOLS.find((t) => t.name === rawName)
		if (!tool?.available) return true
		const runtime = runtimePortOrNull()
		if (!runtime) return false
		return tool.available(origin, { domiaId: provider.domiaId, runtime })
	},
	resolveArgs: (_provider, rawName, args) => {
		const tool = builtinTool(rawName)
		return tool ? withoutInvalidOptionals(tool, args) : args
	},
	inferWriteTarget: (_provider, rawName, args, transcript, language) => {
		const tool = builtinTool(rawName)
		return tool
			? spokenTimeFor(tool, args, transcript, language)
			: { kind: "targeted" }
	},
	describeInvocation: (provider, rawName, args, language) => {
		const routine = routineForTool(provider.domiaId, rawName)
		if (routine)
			return {
				summary: fillPlaceholders(
					languageSetsFor(language).phrases.confirmRoutineSummary,
					{ name: routine.name },
				),
			}
		const tool = DOMIA_TOOLS.find((t) => t.name === rawName)
		if (!tool) return null
		const summary = packFor(tool, language).confirmSummary
		if (!summary) return { implicit: true }
		return { implicit: true, summary: fillPlaceholders(summary, args) }
	},
}
