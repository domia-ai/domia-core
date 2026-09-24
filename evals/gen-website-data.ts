import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { format, resolveConfig } from "prettier"

import type { FastPathIntentType, FastPathSlotType, ToolPolicyType } from "@/db"
import {
	BUILTIN_PROVIDER_NAME,
	DEFAULT_BUILTIN_TOOLS,
	DEFAULT_FAST_PATH_DURATION_MAX_SECONDS,
	DEFAULT_FAST_PATH_ENABLED,
	DEFAULT_FAST_PATH_MAX_UTTERANCE_CHARS,
	DEFAULT_FAST_PATH_MIN_COVERAGE,
	DEFAULT_SKILLS_ENGINE,
	FAST_PATH_SKIP_PHRASES_PER_SIDE,
	ROUTINE_MAX_STEPS,
	ROUTINE_TOOL_PREFIX,
	SKILL_DESCRIPTOR_RESOURCE_URI,
	SKILL_SERVER_DESCRIPTOR_MAX_BYTES,
	SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATES,
	SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATE_CHARS,
	SKILL_SERVER_DESCRIPTOR_STRIPPED_FIELDS,
} from "@/db/constants/skills"
import {
	lintTemplate,
	parseTemplate,
	prefilterOf,
} from "@/modules/fast-path/utils/grammar"
import { DOMIA_TOOLS } from "@/modules/skill-engine/specializations/domia/tools"
import type {
	BuiltinToolPackType,
	BuiltinToolType,
} from "@/modules/skill-engine/types"
import {
	HA_ACTION_VERBS,
	HA_BUILTIN_SHADOWED_TOOLS,
	HA_CONTEXT_TOOL,
	HA_FAST_PATH_EXCLUDED_DOMAINS,
	HA_FAST_PATH_NAME_GROUPS,
	HA_FAST_PATH_PACKS,
	HA_SENSITIVE_TOOL_RE,
	HA_SPECIALIZATION_KIND,
} from "@/modules/skill-engine/specializations/home-assistant/constants"
import {
	MA_DEFAULT_TOOL_WHITELIST,
	MA_FAST_PATH_PACKS,
	MA_READ_TOOLS,
	MA_SPECIALIZATION_KIND,
	MA_TOOL_MUSIC_PLAY,
	MA_TOOL_PLAY_MEDIA,
	MA_VIRTUAL_TOOLS,
} from "@/modules/skill-engine/specializations/music-assistant/constants"
import { languageSetsFor } from "@/utils/language-catalogs/registry"

import type {
	WebsiteCorpusBaselineType,
	WebsiteCorpusSweepType,
	WebsiteDataMetaType,
	WebsiteFastPathDemoAreaType,
	WebsiteFastPathDemoEntityType,
	WebsiteFastPathFileType,
	WebsiteFastPathIntentType,
	WebsiteFastPathLanguageStatsType,
	WebsiteFastPathPackType,
	WebsiteFastPathPresetType,
	WebsiteFastPathSlotType,
	WebsiteFastPathTemplateType,
	WebsiteSkillExampleType,
	WebsiteSkillGroupType,
	WebsiteSkillToolType,
	WebsiteSkillsFileType,
	WebsiteSourcedPackType,
} from "./types"

const LANGUAGES = ["en", "es"]
const OUTPUT_DIR = resolve(
	process.env.WEBSITE_DATA_DIR ?? "../domia-website/src/data",
)
const BASELINE_FILE = join(
	process.cwd(),
	"evals",
	"fixtures",
	"ha-intents",
	"baseline.json",
)
const SWEEP_FILE = join(
	process.cwd(),
	"evals",
	"bench-results",
	"ha-intents-sweep.json",
)
const GENERATOR = "domia-core/evals/gen-website-data.ts"
const MAX_INTENTS_PER_LANGUAGE = 40
const MAX_TEMPLATES_PER_INTENT = 4
const HA_SLICE_TOOL_CAPS: Record<string, number> = {
	HassTurnOn: 7,
	HassTurnOff: 7,
	HassLightSet: 2,
	HassSetPosition: 2,
}
const HA_SLICE_SLOT_KEYS = new Set([
	"entity",
	"area",
	"coverClasses",
	"level",
	"position",
])
const HA_SLICE_SKIPPED_CONTEXT_KEYS = new Set(["entity:valve"])
const MA_ROSTER_SLOTS = new Set(["player", "playerQueue"])

const PRESETS: WebsiteFastPathPresetType[] = [
	{ id: "en-light-off", language: "en", text: "turn off the kitchen light" },
	{ id: "en-timer", language: "en", text: "set a timer for ten minutes" },
	{ id: "en-music", language: "en", text: "play jazz in the office" },
	{ id: "en-wifi", language: "en", text: "what's the wifi password?" },
	{ id: "en-lock", language: "en", text: "lock the front door" },
	{ id: "en-chat", language: "en", text: "how was your day?" },
	{ id: "es-light-off", language: "es", text: "apaga la luz de la cocina" },
	{
		id: "es-timer",
		language: "es",
		text: "pon un temporizador de diez minutos",
	},
	{ id: "es-music", language: "es", text: "pon jazz en la oficina" },
	{ id: "es-wifi", language: "es", text: "¿cuál es la clave del wifi?" },
	{ id: "es-lock", language: "es", text: "cierra la puerta principal" },
	{ id: "es-chat", language: "es", text: "¿qué tal tu día?" },
]

const DEMO_AREAS: WebsiteFastPathDemoAreaType[] = [
	{ id: "kitchen", names: { en: "kitchen", es: "cocina" } },
	{ id: "office", names: { en: "office", es: "oficina" } },
	{ id: "living-room", names: { en: "living room", es: "sala" } },
	{ id: "bedroom", names: { en: "bedroom", es: "dormitorio" } },
	{ id: "garage", names: { en: "garage", es: "garaje" } },
	{ id: "hallway", names: { en: "hallway", es: "pasillo" } },
	{ id: "entry", names: { en: "entry", es: "entrada" } },
]

const DEMO_ENTITIES: WebsiteFastPathDemoEntityType[] = [
	{
		id: "light.kitchen",
		domain: "light",
		area: "kitchen",
		names: { en: "kitchen light", es: "luz de la cocina" },
	},
	{
		id: "light.office",
		domain: "light",
		area: "office",
		names: { en: "office lights", es: "luces de la oficina" },
	},
	{
		id: "light.living_room_lamp",
		domain: "light",
		area: "living-room",
		names: { en: "living room lamp", es: "lámpara de la sala" },
	},
	{
		id: "light.bedroom",
		domain: "light",
		area: "bedroom",
		names: { en: "bedroom light", es: "luz del dormitorio" },
	},
	{
		id: "switch.hallway",
		domain: "switch",
		area: "hallway",
		names: { en: "hallway switch", es: "interruptor del pasillo" },
	},
	{
		id: "lock.front_door",
		domain: "lock",
		area: "entry",
		names: { en: "front door", es: "puerta principal" },
	},
	{
		id: "cover.garage_door",
		domain: "cover",
		area: "garage",
		names: { en: "garage door", es: "puerta del garaje" },
	},
	{
		id: "cover.bedroom_blinds",
		domain: "cover",
		area: "bedroom",
		names: { en: "bedroom blinds", es: "persianas del dormitorio" },
	},
	{
		id: "media_player.office_speaker",
		domain: "media_player",
		area: "office",
		names: { en: "office speaker", es: "altavoz de la oficina" },
	},
	{
		id: "climate.thermostat",
		domain: "climate",
		area: "hallway",
		names: { en: "thermostat", es: "termostato" },
	},
]

const readJson = <T>(file: string): T =>
	JSON.parse(readFileSync(file, "utf8")) as T

const writeJson = async (file: string, value: unknown): Promise<void> => {
	const config = (await resolveConfig(process.cwd())) ?? {}
	const text = await format(JSON.stringify(value, null, "\t"), {
		...config,
		parser: "json",
	})
	writeFileSync(file, text)
}

const metaOf = (source: string): WebsiteDataMetaType => ({
	source,
	capturedAt: new Date().toISOString(),
	generator: GENERATOR,
})

const compileTemplate = (
	source: string,
	rules: Record<string, string>,
): WebsiteFastPathTemplateType => {
	const ast = parseTemplate(source, rules)
	lintTemplate(ast, source)
	return { source, ast, prefilter: prefilterOf(ast).pattern }
}

const slotOf = (
	name: string,
	slot: FastPathSlotType,
): WebsiteFastPathSlotType | null => {
	const arg = slot.arg ?? name
	const source = slot.source
	if (source.kind === "context")
		return { kind: "context", arg, key: source.key }
	if (source.kind === "enum")
		return {
			kind: "values",
			arg,
			values: source.values.map((v) => ({ phrase: v, args: { [arg]: v } })),
		}
	if (source.kind === "map")
		return {
			kind: "values",
			arg,
			values: source.values.flatMap((entry) =>
				entry.in.map((phrase) => ({ phrase, args: { [arg]: entry.out } })),
			),
		}
	if (source.kind === "range")
		return { kind: "range", arg, min: source.min, max: source.max }
	if (source.kind === "duration")
		return {
			kind: "duration",
			arg,
			maxSeconds: source.maxSeconds ?? DEFAULT_FAST_PATH_DURATION_MAX_SECONDS,
		}
	if (source.kind === "clockTime") return { kind: "clockTime", arg }
	return null
}

const intentOf = (
	intent: FastPathIntentType,
	provider: string,
	rules: Record<string, string>,
): WebsiteFastPathIntentType | null => {
	const slots: Record<string, WebsiteFastPathSlotType> = {}
	for (const [name, slot] of Object.entries(intent.slots ?? {})) {
		const converted = slotOf(name, slot)
		if (!converted) return null
		slots[name] = converted
	}
	return {
		tool: intent.tool,
		provider,
		templates: intent.templates
			.slice(0, MAX_TEMPLATES_PER_INTENT)
			.map((src) => compileTemplate(src, rules)),
		slots,
		requiredKeywords: intent.requiredKeywords ?? [],
		argDefaults: intent.argDefaults ?? {},
		priority: intent.priority ?? 0,
		...(intent.allowBlockedTokens ? { allowBlockedTokens: true } : {}),
	}
}

const builtinPackFor = (
	tool: BuiltinToolType,
	language: string,
): BuiltinToolPackType | undefined =>
	Object.hasOwn(tool.packs, language) ? tool.packs[language] : undefined

const builtinPack = (language: string): WebsiteSourcedPackType => ({
	provider: BUILTIN_PROVIDER_NAME,
	block: {
		intents: DOMIA_TOOLS.flatMap((tool) =>
			(builtinPackFor(tool, language)?.intents ?? []).map((intent) => ({
				...intent,
				tool: tool.name,
			})),
		),
		expansionRules: DOMIA_TOOLS.reduce<Record<string, string>>(
			(rules, tool) => ({
				...rules,
				...(builtinPackFor(tool, language)?.expansionRules ?? {}),
			}),
			{},
		),
	},
})

const shippedPacks = (language: string): WebsiteSourcedPackType[] => [
	builtinPack(language),
	{ provider: HA_SPECIALIZATION_KIND, block: HA_FAST_PATH_PACKS[language] },
	{ provider: MA_SPECIALIZATION_KIND, block: MA_FAST_PATH_PACKS[language] },
]

const isHaSliceIntent = (intent: FastPathIntentType): boolean =>
	intent.tool in HA_SLICE_TOOL_CAPS &&
	Object.entries(intent.slots ?? {}).every(
		([name, slot]) =>
			HA_SLICE_SLOT_KEYS.has(name) &&
			!(
				slot.source.kind === "context" &&
				HA_SLICE_SKIPPED_CONTEXT_KEYS.has(slot.source.key)
			),
	)

const capPerTool = (
	intents: WebsiteFastPathIntentType[],
	caps: Record<string, number>,
): WebsiteFastPathIntentType[] => {
	const taken: Record<string, number> = {}
	return intents.filter((intent) => {
		const n = taken[intent.tool] ?? 0
		if (n >= (caps[intent.tool] ?? 0)) return false
		taken[intent.tool] = n + 1
		return true
	})
}

const isMaSliceIntent = (intent: FastPathIntentType): boolean =>
	Object.keys(intent.slots ?? {}).every((k) => !MA_ROSTER_SLOTS.has(k))

const curatedIntents = (language: string): WebsiteFastPathIntentType[] => {
	const [builtin, ha, ma] = shippedPacks(language)
	const compile = (
		pack: WebsiteSourcedPackType,
		keep: (intent: FastPathIntentType) => boolean,
	): WebsiteFastPathIntentType[] =>
		pack.block.intents
			.filter(keep)
			.map((intent) =>
				intentOf(intent, pack.provider, pack.block.expansionRules ?? {}),
			)
			.filter((i): i is WebsiteFastPathIntentType => i !== null)
	const builtinIntents = compile(builtin, () => true)
	const maIntents = compile(ma, isMaSliceIntent)
	const haBudget = Math.max(
		0,
		MAX_INTENTS_PER_LANGUAGE - builtinIntents.length - maIntents.length,
	)
	const haIntents = capPerTool(
		compile(ha, isHaSliceIntent),
		HA_SLICE_TOOL_CAPS,
	).slice(0, haBudget)
	return [...haIntents, ...builtinIntents, ...maIntents]
}

const languagePack = (language: string): WebsiteFastPathPackType => {
	const sets = languageSetsFor(language)
	return {
		skipWords: sets.skipWords,
		skipPhrasesPerSide: FAST_PATH_SKIP_PHRASES_PER_SIDE,
		maxUtteranceChars: DEFAULT_FAST_PATH_MAX_UTTERANCE_CHARS,
		blockers: sets.fastPathBlockers,
		minCoverage: DEFAULT_FAST_PATH_MIN_COVERAGE,
		intents: curatedIntents(language),
	}
}

const languageStats = (
	language: string,
	baseline: WebsiteCorpusBaselineType,
	sweep: WebsiteCorpusSweepType,
): WebsiteFastPathLanguageStatsType => {
	const packs = shippedPacks(language)
	const sweepLanguage = sweep.languages.find((l) => l.language === language)
	if (!sweepLanguage) throw new Error(`no sweep row for ${language}`)
	return {
		intents: packs.reduce((n, p) => n + p.block.intents.length, 0),
		templates: packs.reduce(
			(n, p) => n + p.block.intents.reduce((m, i) => m + i.templates.length, 0),
			0,
		),
		corpusActionRows: sweepLanguage.sentences.action,
		corpusMatched: baseline[language].matchedCorrect,
		corpusWrong: baseline[language].wrong,
	}
}

const fastPathFile = (): WebsiteFastPathFileType => {
	const baseline = readJson<WebsiteCorpusBaselineType>(BASELINE_FILE)
	const sweep = readJson<WebsiteCorpusSweepType>(SWEEP_FILE)
	const languages: Record<string, WebsiteFastPathLanguageStatsType> = {}
	const packs: Record<string, WebsiteFastPathPackType> = {}
	for (const language of LANGUAGES) {
		languages[language] = languageStats(language, baseline, sweep)
		packs[language] = languagePack(language)
	}
	const rows = sweep.languages.filter((l) => LANGUAGES.includes(l.language))
	return {
		meta: metaOf(
			"domia-core: fast-path grammar (src/modules/fast-path/utils/grammar.ts), language catalogs (src/utils/language-catalogs), builtin packs (specializations/domia/tools/*/descriptors), HA + MA descriptors (specializations/*/descriptors/{en,es}.json), evals/fixtures/ha-intents/baseline.json, evals/bench-results/ha-intents-sweep.json",
		),
		stats: {
			languages,
			falsePositives: LANGUAGES.reduce(
				(n, l) => n + baseline[l].falsePositives,
				0,
			),
			matchMsP50: Math.max(...rows.map((l) => l.fastPathMs.p50)),
			matchMsP95: Math.max(...rows.map((l) => l.fastPathMs.p95)),
		},
		excludedDomains: [...HA_FAST_PATH_EXCLUDED_DOMAINS],
		nameGroups: HA_FAST_PATH_NAME_GROUPS,
		languages: packs,
		presets: PRESETS,
		demoHome: { areas: DEMO_AREAS, entities: DEMO_ENTITIES },
	}
}

const fastPathToolsOf = (packs: WebsiteSourcedPackType[]): Set<string> =>
	new Set(packs.flatMap((p) => p.block.intents.map((i) => i.tool)))

const haPolicyOf = (tool: string): ToolPolicyType => {
	if (HA_BUILTIN_SHADOWED_TOOLS.has(tool)) return "block"
	if (HA_SENSITIVE_TOOL_RE.test(tool)) return "confirm"
	return "allow"
}

const skillsFile = (): WebsiteSkillsFileType => {
	const [builtin, ha, ma] = shippedPacks("en")
	const fastPathTools = fastPathToolsOf([builtin, ha, ma])
	const builtinTools: WebsiteSkillToolType[] = DOMIA_TOOLS.map((tool) => ({
		id: tool.name,
		fastPath: fastPathTools.has(tool.name),
		hidden: tool.hiddenFromLlm === true,
		policy: tool.policy ?? "allow",
	}))
	const haToolIds = [
		...new Set([
			...ha.block.intents.map((i) => i.tool),
			...Object.keys(HA_ACTION_VERBS.en),
			HA_CONTEXT_TOOL,
		]),
	]
	const haTools: WebsiteSkillToolType[] = haToolIds.map((id) => ({
		id,
		fastPath: fastPathTools.has(id),
		hidden: false,
		policy: haPolicyOf(id),
	}))
	const maToolIds = [
		...new Set([
			...MA_VIRTUAL_TOOLS,
			MA_TOOL_PLAY_MEDIA,
			...MA_DEFAULT_TOOL_WHITELIST,
			...MA_READ_TOOLS,
		]),
	]
	const maTools: WebsiteSkillToolType[] = maToolIds.map((id) => ({
		id,
		fastPath: fastPathTools.has(id),
		hidden: false,
		policy: "allow",
	}))
	const groups: WebsiteSkillGroupType[] = [
		{
			id: "builtin",
			alwaysOn: false,
			defaultOn: DEFAULT_BUILTIN_TOOLS,
			tools: builtinTools,
		},
		{
			id: "homeAssistant",
			alwaysOn: false,
			defaultOn: DEFAULT_SKILLS_ENGINE,
			tools: haTools,
		},
		{
			id: "musicAssistant",
			alwaysOn: false,
			defaultOn: DEFAULT_SKILLS_ENGINE,
			tools: maTools,
		},
		{
			id: "mcp",
			alwaysOn: false,
			defaultOn: DEFAULT_SKILLS_ENGINE,
			tools: [],
		},
		{
			id: "routines",
			alwaysOn: false,
			defaultOn: DEFAULT_SKILLS_ENGINE,
			tools: [],
		},
	]
	const exampleOf = (
		id: WebsiteSkillExampleType["id"],
		group: WebsiteSkillGroupType["id"],
		tools: WebsiteSkillToolType[],
		tool: string,
	): WebsiteSkillExampleType => {
		const found = tools.find((candidate) => candidate.id === tool)
		if (!found) throw new Error(`skills example ${id}: unknown tool ${tool}`)
		return { id, group, tool, fastPath: found.fastPath }
	}
	const examples: WebsiteSkillExampleType[] = [
		exampleOf("timer", "builtin", builtinTools, "timer"),
		exampleOf("lights", "homeAssistant", haTools, "HassTurnOff"),
		exampleOf("music", "musicAssistant", maTools, MA_TOOL_MUSIC_PLAY),
		{
			id: "goodNight",
			group: "routines",
			tool: `${ROUTINE_TOOL_PREFIX}good_night`,
			fastPath: true,
		},
		{
			id: "descriptor",
			group: "mcp",
			tool: "open_pull_request",
			fastPath: false,
		},
	]
	return {
		meta: metaOf(
			"domia-core: specializations/domia/tools (DOMIA_TOOLS: name, hiddenFromLlm, policy), specializations/home-assistant/constants (HA_ACTION_VERBS, HA_CONTEXT_TOOL, HA_SENSITIVE_TOOL_RE, HA_BUILTIN_SHADOWED_TOOLS), specializations/music-assistant/constants (MA tool ids), src/db/constants/skills.ts (ROUTINE_MAX_STEPS, SKILL_DESCRIPTOR_RESOURCE_URI, SKILL_SERVER_DESCRIPTOR_*); alwaysOn/defaultOn are per-identity flags (builtin_tools = DEFAULT_BUILTIN_TOOLS, skills_engine = DEFAULT_SKILLS_ENGINE in src/db/constants/skills.ts), both switchable from the console; examples: fastPath from the same packs (routines with phrases register fast-path templates via specializations/domia/routines.ts; routine tool = ROUTINE_TOOL_PREFIX + slug; the MCP tool id is illustrative)",
		),
		groups,
		examples,
		routineMaxSteps: ROUTINE_MAX_STEPS,
		descriptorResource: SKILL_DESCRIPTOR_RESOURCE_URI,
		strippedPolicyFields: [...SKILL_SERVER_DESCRIPTOR_STRIPPED_FIELDS],
		descriptorLimits: {
			maxBytes: SKILL_SERVER_DESCRIPTOR_MAX_BYTES,
			maxTemplates: SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATES,
			maxTemplateChars: SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATE_CHARS,
		},
		defaults: {
			fastPathEnabled: DEFAULT_FAST_PATH_ENABLED,
			skillsEngine: DEFAULT_SKILLS_ENGINE,
			builtinTools: DEFAULT_BUILTIN_TOOLS,
		},
	}
}

const printSummary = (
	fastPath: WebsiteFastPathFileType,
	skills: WebsiteSkillsFileType,
): void => {
	for (const [language, pack] of Object.entries(fastPath.languages)) {
		const stats = fastPath.stats.languages[language]
		const byProvider = pack.intents.reduce<Record<string, number>>(
			(acc, i) => ({ ...acc, [i.provider]: (acc[i.provider] ?? 0) + 1 }),
			{},
		)
		console.log(
			`${language}: slice ${pack.intents.length} intents (${Object.entries(
				byProvider,
			)
				.map(([p, n]) => `${p} ${n}`)
				.join(
					", ",
				)}) · shipped ${stats.intents} intents / ${stats.templates} templates · corpus ${stats.corpusMatched}/${stats.corpusActionRows} matched, ${stats.corpusWrong} wrong`,
		)
	}
	console.log(
		`false positives ${fastPath.stats.falsePositives} · match p50 ${fastPath.stats.matchMsP50} ms · p95 ${fastPath.stats.matchMsP95} ms`,
	)
	for (const group of skills.groups)
		console.log(
			`${group.id}: ${group.tools.length} tools (${group.tools.filter((t) => t.fastPath).length} fast-path, ${group.tools.filter((t) => t.hidden).length} hidden, ${group.tools.filter((t) => t.policy !== "allow").length} gated)`,
		)
}

const main = async (): Promise<void> => {
	if (!existsSync(BASELINE_FILE))
		throw new Error(`no corpus baseline at ${BASELINE_FILE}`)
	if (!existsSync(SWEEP_FILE))
		throw new Error(`no corpus sweep results at ${SWEEP_FILE}`)
	mkdirSync(OUTPUT_DIR, { recursive: true })
	const fastPath = fastPathFile()
	const skills = skillsFile()
	await writeJson(join(OUTPUT_DIR, "fast-path.json"), fastPath)
	await writeJson(join(OUTPUT_DIR, "skills.json"), skills)
	printSummary(fastPath, skills)
	console.log(`\nwrote fast-path.json + skills.json → ${OUTPUT_DIR}`)
}

void main()
