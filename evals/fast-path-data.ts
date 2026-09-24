import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { performance } from "node:perf_hooks"

import type {
	DomiaSkillDescriptorType,
	FastPathBlockType,
	FastPathIntentType,
	SelectSkillProviderType,
} from "@/db"
import { domiaSkillDescriptorSchema } from "@/modules/skill-engine/schemas"
import { resolveDescriptor } from "@/modules/skill-engine/utils/descriptor"
import type {
	SkillConnHandleType,
	SkillConnectionType,
	SkillSpecializationType,
} from "@/modules/skill-engine/types"
import {
	HA_FAST_PATH_ENTITY_KEY_PREFIX,
	HA_FAST_PATH_ENTITY_DOMAIN_SEPARATOR,
	HA_FAST_PATH_NAME_GROUPS,
	HA_FAST_PATH_SLOT_KEYS,
	HA_SPECIALIZATION_KIND,
} from "@/modules/skill-engine/specializations/home-assistant/constants"
import {
	MA_SLOT_PLAYER,
	MA_SLOT_PLAYER_QUEUE,
	MA_SPECIALIZATION_KIND,
} from "@/modules/skill-engine/specializations/music-assistant/constants"
import {
	lintTemplate,
	parseTemplate,
	prefilterOf,
} from "@/modules/fast-path/utils/grammar"
import { compileIndex } from "@/modules/fast-path/utils/compile"
import { fold } from "@/modules/fast-path/utils/normalize"
import type { FastPathAstNodeType } from "@/modules/fast-path/types"

import { HA_MCP_TOOLS, haProviderRow, makeChecker } from "./lib"
import type { FastPathDataPackType, FastPathSyntheticEntityType } from "./types"

const checker = makeChecker()
const SPECIALIZATIONS_DIR = join(
	process.cwd(),
	"src",
	"modules",
	"skill-engine",
	"specializations",
)
const LANGUAGES = ["en", "es"]
const COMPILE_BUDGET_MS = 200
const MEDIA_TOOL_RE = /Media|Volume/
const MEDIA_WORDS: Record<string, string[]> = {
	en: ["play", "pause", "music", "song", "track", "volume", "speaker", "mute"],
	es: [
		"música",
		"canción",
		"reproduce",
		"pausa",
		"volumen",
		"bocina",
		"altavoz",
	],
}

const packFile = (kind: string, file: string): string =>
	join(SPECIALIZATIONS_DIR, kind, "descriptors", file)

const loadPack = (kind: string, file: string): FastPathDataPackType | null => {
	const path = packFile(kind, file)
	try {
		const descriptor: DomiaSkillDescriptorType =
			domiaSkillDescriptorSchema.parse(JSON.parse(readFileSync(path, "utf8")))
		checker.check(
			`${kind}/${file}: strict descriptor with a fastPath block of kind ${kind}`,
			descriptor.kind === kind && descriptor.fastPath !== undefined,
		)
		if (!descriptor.fastPath) return null
		return { kind, file, block: descriptor.fastPath }
	} catch (err) {
		checker.check(
			`${kind}/${file}: parses with the strict descriptor schema`,
			false,
			err instanceof Error ? err.message.slice(0, 200) : String(err),
		)
		return null
	}
}

const slotNamesIn = (nodes: FastPathAstNodeType[]): string[] =>
	nodes.flatMap((node) => {
		if (node.kind === "slot") return [node.name]
		if (node.kind === "optional") return slotNamesIn(node.body)
		if (node.kind === "group") return node.alternatives.flatMap(slotNamesIn)
		return []
	})

const literalWordsIn = (nodes: FastPathAstNodeType[]): string[] =>
	nodes.flatMap((node) => {
		if (node.kind === "text") return node.value.split(" ")
		if (node.kind === "optional") return literalWordsIn(node.body)
		if (node.kind === "group") return node.alternatives.flatMap(literalWordsIn)
		return []
	})

const isHaSlotKey = (key: string): boolean => {
	if (HA_FAST_PATH_SLOT_KEYS.includes(key)) return true
	if (!key.startsWith(HA_FAST_PATH_ENTITY_KEY_PREFIX)) return false
	const domains = key
		.slice(HA_FAST_PATH_ENTITY_KEY_PREFIX.length)
		.split(HA_FAST_PATH_ENTITY_DOMAIN_SEPARATOR)
	return domains.length > 0 && domains.every((d) => /^[a-z_]+$/.test(d))
}

const isMaSlotKey = (key: string): boolean =>
	key === MA_SLOT_PLAYER || key === MA_SLOT_PLAYER_QUEUE

const checkPack = (pack: FastPathDataPackType): void => {
	const { kind, file, block } = pack
	const label = `${kind}/${file}`
	const language = basename(file, ".json")
	const rules = block.expansionRules ?? {}
	const rejected: string[] = []
	const undeclaredSlots: string[] = []
	const badKeys: string[] = []
	const mediaTools: string[] = []
	const mediaLiterals: string[] = []
	let prefiltersCompiled = 0
	let templates = 0
	const mediaWords = new Set((MEDIA_WORDS[language] ?? []).map(fold))
	for (const intent of block.intents) {
		if (kind === HA_SPECIALIZATION_KIND && MEDIA_TOOL_RE.test(intent.tool))
			mediaTools.push(intent.tool)
		const declared = new Set(Object.keys(intent.slots ?? {}))
		for (const [name, slot] of Object.entries(intent.slots ?? {})) {
			if (slot.source.kind !== "context") continue
			const ok =
				kind === HA_SPECIALIZATION_KIND
					? isHaSlotKey(slot.source.key)
					: isMaSlotKey(slot.source.key)
			if (!ok) badKeys.push(`${intent.tool}.${name} → ${slot.source.key}`)
		}
		for (const template of intent.templates) {
			templates++
			try {
				const ast = parseTemplate(template, rules)
				lintTemplate(ast, template)
				new RegExp(prefilterOf(ast).pattern, "i")
				prefiltersCompiled++
				for (const slot of slotNamesIn(ast))
					if (!declared.has(slot))
						undeclaredSlots.push(`${intent.tool}: {${slot}} in ${template}`)
				if (kind === HA_SPECIALIZATION_KIND)
					for (const word of literalWordsIn(ast))
						if (mediaWords.has(fold(word)))
							mediaLiterals.push(`${intent.tool}: "${word}" in ${template}`)
			} catch (err) {
				rejected.push(
					`${template} — ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`,
				)
			}
		}
	}
	checker.check(
		`${label}: every template parses and lints (${templates} templates, ${block.intents.length} intents)`,
		rejected.length === 0,
		rejected.slice(0, 3).join(" | "),
	)
	checker.check(
		`${label}: every prefilter regex compiles`,
		prefiltersCompiled === templates,
	)
	checker.check(
		`${label}: every slot used in a template is declared on its intent`,
		undeclaredSlots.length === 0,
		undeclaredSlots.slice(0, 3).join(" | "),
	)
	checker.check(
		`${label}: every context key belongs to the ${kind} slot vocabulary`,
		badKeys.length === 0,
		badKeys.slice(0, 3).join(" | "),
	)
	if (kind !== HA_SPECIALIZATION_KIND) return
	checker.check(
		`${label}: no tool matches ${String(MEDIA_TOOL_RE)}`,
		mediaTools.length === 0,
		mediaTools.join(","),
	)
	checker.check(
		`${label}: no template literal is a media word (${(MEDIA_WORDS[language] ?? []).join("|")})`,
		mediaLiterals.length === 0,
		mediaLiterals.slice(0, 3).join(" | "),
	)
}

const SYNTHETIC_AREAS = [
	"Kitchen",
	"Bedroom",
	"Living Room",
	"Office",
	"Bathroom",
	"Garage",
	"Hallway",
	"Garden",
]
const SYNTHETIC_FLOORS = ["Ground Floor", "First Floor"]
const SYNTHETIC_DOMAINS: [string, number][] = [
	["light", 15],
	["switch", 5],
	["fan", 5],
	["cover", 5],
	["climate", 3],
	["lock", 2],
	["vacuum", 1],
	["media_player", 2],
	["scene", 1],
	["script", 1],
	["valve", 1],
	["lawn_mower", 1],
	["input_boolean", 1],
]

const syntheticSite = (): FastPathSyntheticEntityType[] => {
	const out: FastPathSyntheticEntityType[] = []
	for (const [domain, count] of SYNTHETIC_DOMAINS)
		for (let i = 0; i < count; i++) {
			const area = SYNTHETIC_AREAS[out.length % SYNTHETIC_AREAS.length]
			out.push({
				name: `${area} ${domain.replace("_", " ")} ${i + 1}`,
				domain,
				area,
				floor: SYNTHETIC_FLOORS[out.length % SYNTHETIC_FLOORS.length],
			})
		}
	return out
}

const entityDomainsOf = (key: string): Set<string> | null => {
	if (key === "entity") return null
	const spec = key.slice(HA_FAST_PATH_ENTITY_KEY_PREFIX.length)
	return new Set(
		spec.split(",").flatMap((d) => HA_FAST_PATH_NAME_GROUPS[d] ?? [d]),
	)
}

const syntheticSlotValues = (
	site: FastPathSyntheticEntityType[],
	key: string,
): { phrase: string; args: Record<string, unknown> }[] | null => {
	if (key === "area")
		return SYNTHETIC_AREAS.map((area) => ({ phrase: area, args: { area } }))
	if (key === "floor")
		return SYNTHETIC_FLOORS.map((floor) => ({ phrase: floor, args: { floor } }))
	if (!isHaSlotKey(key)) return null
	const domains = entityDomainsOf(key)
	const values = site
		.filter((e) => !domains || domains.has(e.domain))
		.map((e) => ({ phrase: e.name, args: { name: e.name } }))
	return values.length > 0 ? values : null
}

const stubHandle = (): SkillConnHandleType => ({
	listTools: () => Promise.resolve({ tools: [] }),
	callTool: () =>
		Promise.resolve({
			text: "",
			status: "ok" as const,
			isError: false,
			structured: null,
		}),
	close: () => Promise.resolve(),
})

const syntheticConnection = (
	block: FastPathBlockType,
	language: string,
	site: FastPathSyntheticEntityType[],
): SkillConnectionType => {
	const provider: SelectSkillProviderType = haProviderRow(
		"http://127.0.0.1:1/mcp",
		randomUUID(),
		HA_MCP_TOOLS,
	)
	const specialization: SkillSpecializationType = {
		kind: HA_SPECIALIZATION_KIND,
		descriptorDefaults: () => ({
			version: 1,
			kind: HA_SPECIALIZATION_KIND,
			fastPath: block,
		}),
		fastPathSlotValues: (_provider, key) => syntheticSlotValues(site, key),
	}
	return {
		providerId: provider.id,
		providerSlug: "home-assistant",
		name: provider.name,
		maxResultChars: provider.maxResultChars,
		timeoutMs: provider.timeout,
		allowedTools: new Set((provider.toolsCache ?? []).map((t) => t.rawName)),
		descriptor: resolveDescriptor(provider, language),
		toolMeta: new Map(),
		toolsFreshUntil: null,
		language,
		provider,
		specialization,
		handle: stubHandle(),
	}
}

const boundBlock = (
	block: FastPathBlockType,
	tools: readonly string[],
): FastPathBlockType => ({
	...block,
	intents: block.intents.filter((intent: FastPathIntentType) =>
		tools.includes(intent.tool),
	),
})

const checkCompileBudget = (pack: FastPathDataPackType): void => {
	const language = basename(pack.file, ".json")
	const site = syntheticSite()
	const tools = HA_MCP_TOOLS.map((t) => t.rawName)
	const block = boundBlock(pack.block, tools)
	const conn = syntheticConnection(block, language, site)
	const cold = performance.now()
	const index = compileIndex([conn], language)
	const coldMs = performance.now() - cold
	const warm = performance.now()
	compileIndex([conn], language)
	const warmMs = performance.now() - warm
	checker.check(
		`home-assistant/${pack.file}: compiles against a ${site.length}-entity site under ${COMPILE_BUDGET_MS} ms (cold ${coldMs.toFixed(1)} ms, warm ${warmMs.toFixed(1)} ms)`,
		coldMs < COMPILE_BUDGET_MS,
	)
	const compilable = block.intents.filter((intent) =>
		Object.values(intent.slots ?? {}).every(
			(slot) =>
				slot.source.kind !== "context" ||
				syntheticSlotValues(site, slot.source.key) !== null,
		),
	)
	checker.check(
		`home-assistant/${pack.file}: every intent whose slots resolve compiles (${index.intents.length}/${compilable.length} of ${block.intents.length})`,
		index.intents.length === compilable.length &&
			compilable.length === block.intents.length,
	)
	const unknownTools = pack.block.intents
		.map((i) => i.tool)
		.filter((t) => !tools.includes(t))
	checker.check(
		`home-assistant/${pack.file}: every intent tool is an HA MCP tool`,
		unknownTools.length === 0,
		[...new Set(unknownTools)].join(","),
	)
}

const main = (): void => {
	const packs = [
		...LANGUAGES.map((l) => loadPack(HA_SPECIALIZATION_KIND, `${l}.json`)),
		...LANGUAGES.map((l) =>
			loadPack(HA_SPECIALIZATION_KIND, join("base", `${l}.json`)),
		),
		...LANGUAGES.map((l) => loadPack(MA_SPECIALIZATION_KIND, `${l}.json`)),
	].filter((p): p is FastPathDataPackType => p !== null)
	for (const pack of packs) checkPack(pack)
	for (const pack of packs)
		if (pack.kind === HA_SPECIALIZATION_KIND && !pack.file.includes("base"))
			checkCompileBudget(pack)
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} fast-path data checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

main()
