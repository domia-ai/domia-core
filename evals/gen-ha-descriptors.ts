import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

import { parse as parseYaml } from "yaml"
import { z } from "zod"

import type {
	FastPathBlockType,
	FastPathIntentType,
	FastPathSlotType,
} from "@/db"
import { domiaSkillDescriptorSchema } from "@/modules/skill-engine/schemas"
import { parseTemplate, lintTemplate } from "@/modules/fast-path/utils/grammar"
import type { FastPathAstNodeType } from "@/modules/fast-path/types"

import { writeFormattedJson } from "./lib/format"
import type {
	HaCorpusCombinationType,
	HaCorpusListType,
	HaCorpusSentenceBlockType,
	HaDescriptorBlockSkipReasonType,
	HaDescriptorDraftType,
	HaDescriptorIntentReportType,
	HaDescriptorLanguageReportType,
	HaDescriptorNodeType,
	HaDescriptorTemplateDropReasonType,
	HassilNodeType,
} from "./types"

const LANGUAGES = ["en", "es"]
const CORPUS_DIR = resolve(
	process.env.HA_INTENTS_DIR ?? "../project-references/intents",
)
const DESCRIPTORS_DIR = join(
	process.cwd(),
	"src",
	"modules",
	"skill-engine",
	"specializations",
	"home-assistant",
	"descriptors",
)
const INCLUDE_CONTEXT_AREA = process.argv.includes("--include-context-area")

const SCOPE = [
	"HassTurnOn",
	"HassTurnOff",
	"HassLightSet",
	"HassSetPosition",
	"HassStopMoving",
	"HassClimateSetTemperature",
	"HassClimateSetFanMode",
	"HassFanSetSpeed",
	"HassHumidifierSetpoint",
	"HassHumidifierMode",
	"HassVacuumStart",
	"HassVacuumReturnToBase",
	"HassVacuumCleanArea",
	"HassLawnMowerDock",
	"HassLawnMowerStartMowing",
]

const TARGET_SLOTS = ["name", "area", "floor"]
const MEDIA_DOMAIN = "media_player"
const DEFAULT_NAME_GROUP = "default"
const ENTITY_SLOT = "entity"
const ENTITY_KEY_PREFIX = "entity:"
const LIST_ARGS = new Set(["device_class", "domain"])
const MAX_PERMUTATION_PARTS = 3
const MAX_EXPANSION = 500
const MAX_RULE_DEPTH = 8
const MAX_DROPPED_SAMPLES = 6

const PARTICLES: Record<string, string[]> = {
	en: [
		"on",
		"off",
		"out",
		"to",
		"in",
		"at",
		"of",
		"up",
		"down",
		"the",
		"a",
		"an",
		"my",
		"our",
		"all",
	],
	es: [
		"a",
		"al",
		"en",
		"de",
		"del",
		"el",
		"la",
		"los",
		"las",
		"un",
		"una",
		"con",
		"mi",
		"mis",
		"y",
		"o",
		"lo",
	],
}

const particlesOf = (language: string): Set<string> =>
	new Set(PARTICLES[language] ?? PARTICLES.en)

const scalar = z.union([z.string(), z.number(), z.boolean()])

const rawSentenceBlockSchema = z.looseObject({
	sentences: z.array(z.string()),
	name_domains: z
		.union([z.string(), z.array(z.string())])
		.optional()
		.nullable(),
	inferred_domain: z.string().optional().nullable(),
	speech_to_phrase: z.boolean().optional().nullable(),
})

const rawSentenceFileSchema = z.looseObject({
	language: z.string(),
	data: z.array(rawSentenceBlockSchema),
})

const rawRulesFileSchema = z.looseObject({
	expansion_rules: z.record(z.string(), z.string()).optional().nullable(),
})

const rawListSchema = z.union([
	z.object({ range: z.object({ from: z.number(), to: z.number() }) }),
	z.object({
		values: z.array(
			z.union([scalar, z.object({ in: scalar, out: z.unknown().optional() })]),
		),
	}),
	z.object({ wildcard: z.boolean() }),
])

const rawListsFileSchema = z.looseObject({
	lists: z.record(z.string(), rawListSchema).optional().nullable(),
})

const rawIntentsSchema = z.record(
	z.string(),
	z.looseObject({
		slot_combinations: z
			.record(
				z.string(),
				z.looseObject({
					slots: z.array(z.string()).optional().nullable(),
					context_area: z.boolean().optional().nullable(),
					name_domains: z
						.record(z.string(), z.array(z.string()))
						.optional()
						.nullable(),
				}),
			)
			.optional()
			.nullable(),
	}),
)

const readYaml = (file: string): unknown =>
	parseYaml(readFileSync(file, "utf8")) as unknown

const yamlFilesIn = (dir: string): string[] =>
	existsSync(dir)
		? readdirSync(dir)
				.filter((f) => f.endsWith(".yaml") && statSync(join(dir, f)).isFile())
				.sort()
		: []

const stemOf = (file: string): string => file.replace(/\.yaml$/, "")

const camelCase = (name: string): string =>
	name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())

const corpusCommit = (): string =>
	execFileSync("git", ["-C", CORPUS_DIR, "rev-parse", "--short", "HEAD"], {
		encoding: "utf8",
	}).trim()

const loadCombinations = (): Map<
	string,
	Map<string, HaCorpusCombinationType>
> => {
	const intents = rawIntentsSchema.parse(
		readYaml(join(CORPUS_DIR, "intents.yaml")),
	)
	const out = new Map<string, Map<string, HaCorpusCombinationType>>()
	for (const [intent, spec] of Object.entries(intents)) {
		const combos = new Map<string, HaCorpusCombinationType>()
		for (const [name, combo] of Object.entries(spec.slot_combinations ?? {}))
			combos.set(name, {
				slots: combo.slots ?? [],
				contextArea: combo.context_area === true,
				nameDomains: Object.values(combo.name_domains ?? {}).flat(),
			})
		out.set(intent, combos)
	}
	return out
}

const loadBlocks = (language: string): HaCorpusSentenceBlockType[] => {
	const blocks: HaCorpusSentenceBlockType[] = []
	for (const intent of SCOPE) {
		const dir = join(CORPUS_DIR, "sentences", language, intent)
		for (const file of yamlFilesIn(dir)) {
			const parsed = rawSentenceFileSchema.parse(readYaml(join(dir, file)))
			parsed.data.forEach((block, index) =>
				blocks.push({
					intent,
					combination: stemOf(file),
					index,
					sentences: block.sentences,
					nameDomains: block.name_domains ?? null,
					inferredDomain: block.inferred_domain ?? null,
					speechToPhrase: block.speech_to_phrase === true,
				}),
			)
		}
	}
	return blocks
}

const loadRules = (language: string): Record<string, string> => {
	const rules: Record<string, string> = {}
	for (const file of yamlFilesIn(join(CORPUS_DIR, "rules", language)))
		Object.assign(
			rules,
			rawRulesFileSchema.parse(
				readYaml(join(CORPUS_DIR, "rules", language, file)),
			).expansion_rules ?? {},
		)
	return rules
}

const loadLists = (language: string): Map<string, HaCorpusListType> => {
	const lists = new Map<string, HaCorpusListType>()
	for (const dir of [
		join(CORPUS_DIR, "lists"),
		join(CORPUS_DIR, "lists", language),
	])
		for (const file of yamlFilesIn(dir)) {
			const parsed = rawListsFileSchema.parse(readYaml(join(dir, file)))
			for (const [name, list] of Object.entries(parsed.lists ?? {})) {
				if ("wildcard" in list) continue
				if ("range" in list)
					lists.set(name, {
						kind: "range",
						min: list.range.from,
						max: list.range.to,
					})
				else
					lists.set(name, {
						kind: "values",
						values: list.values.map((v) =>
							typeof v === "object"
								? { in: String(v.in), out: v.out ?? v.in }
								: { in: String(v), out: v },
						),
					})
			}
		}
	return lists
}

const findClosing = (
	src: string,
	start: number,
	open: string,
	close: string,
): number => {
	let depth = 0
	for (let i = start; i < src.length; i++) {
		if (src[i] === open) depth++
		else if (src[i] === close) {
			depth--
			if (depth === 0) return i
		}
	}
	return -1
}

const splitTopLevel = (src: string, separator: string): string[] => {
	const parts: string[] = []
	let depth = 0
	let current = ""
	for (const ch of src) {
		if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth++
		else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") depth--
		if (ch === separator && depth === 0) {
			parts.push(current)
			current = ""
		} else current += ch
	}
	parts.push(current)
	return parts
}

const permutationsOf = <T>(items: T[]): T[][] => {
	if (items.length <= 1) return [items]
	return items.flatMap((item, i) =>
		permutationsOf([...items.slice(0, i), ...items.slice(i + 1)]).map(
			(rest) => [item, ...rest],
		),
	)
}

const parseHassil = (src: string): HassilNodeType[] => {
	const alternatives = splitTopLevel(src, "|")
	if (alternatives.length > 1)
		return [{ kind: "group", alternatives: alternatives.map(parseHassil) }]
	const nodes: HassilNodeType[] = []
	let text = ""
	const flush = (): void => {
		if (text.length > 0) nodes.push({ kind: "text", value: text })
		text = ""
	}
	let i = 0
	while (i < src.length) {
		const ch = src[i]
		if (ch === "(") {
			const end = findClosing(src, i, "(", ")")
			if (end < 0) throw new Error(`unbalanced ( in ${src}`)
			flush()
			const inner = src.slice(i + 1, end)
			const parts = splitTopLevel(inner, ";")
			if (parts.length > 1) {
				if (parts.length > MAX_PERMUTATION_PARTS)
					throw new Error(`permutationTooLarge: ${src}`)
				nodes.push({
					kind: "group",
					alternatives: permutationsOf(parts).map((order) =>
						parseHassil(order.map((p) => p.trim()).join(" ")),
					),
				})
			} else nodes.push({ kind: "group", alternatives: [parseHassil(inner)] })
			i = end + 1
		} else if (ch === "[") {
			const end = findClosing(src, i, "[", "]")
			if (end < 0) throw new Error(`unbalanced [ in ${src}`)
			flush()
			nodes.push({ kind: "optional", body: parseHassil(src.slice(i + 1, end)) })
			i = end + 1
		} else if (ch === "{") {
			const end = src.indexOf("}", i)
			if (end < 0) throw new Error(`unbalanced { in ${src}`)
			flush()
			const parts = src
				.slice(i + 1, end)
				.trim()
				.split(":")
			const list = parts[0]
			nodes.push({
				kind: "slot",
				list,
				arg: parts.length > 1 ? parts[1] : list,
			})
			i = end + 1
		} else if (ch === "<") {
			const end = src.indexOf(">", i)
			if (end < 0) throw new Error(`unbalanced < in ${src}`)
			flush()
			nodes.push({ kind: "rule", name: src.slice(i + 1, end).trim() })
			i = end + 1
		} else {
			text += ch
			i++
		}
	}
	flush()
	return nodes.flatMap((n) =>
		n.kind === "group" &&
		n.alternatives.length === 1 &&
		n.alternatives[0].length === 1
			? n.alternatives[0]
			: [n],
	)
}

const normalizeSpace = (value: string): string =>
	value.replace(/\s+/g, " ").trim()

const createConverter = (
	language: string,
	rules: Record<string, string>,
	lists: Map<string, HaCorpusListType>,
) => {
	const slotSpecs = new Map<string, FastPathSlotType>()
	const convertedRules = new Map<string, HaDescriptorNodeType[]>()
	const particles = particlesOf(language)

	const ruleBody = (name: string): HassilNodeType[] => {
		if (!Object.hasOwn(rules, name)) throw new Error(`unknownRule: <${name}>`)
		return parseHassil(rules[name])
	}

	const containsSlot = (nodes: HassilNodeType[]): boolean =>
		nodes.some(
			(n) =>
				n.kind === "slot" ||
				(n.kind === "optional" && containsSlot(n.body)) ||
				(n.kind === "group" && n.alternatives.some(containsSlot)) ||
				(n.kind === "rule" && containsSlot(ruleBody(n.name))),
		)

	const rawStrings = (nodes: HassilNodeType[], depth: number): string[] => {
		if (depth > MAX_RULE_DEPTH) throw new Error("unknownRule: expansion depth")
		let acc: string[] = [""]
		for (const node of nodes) {
			if (node.kind === "slot") throw new Error("slotGlued")
			const parts =
				node.kind === "text"
					? [node.value]
					: node.kind === "rule"
						? rawStrings(ruleBody(node.name), depth + 1)
						: node.kind === "optional"
							? ["", ...rawStrings(node.body, depth + 1)]
							: node.alternatives.flatMap((alt) => rawStrings(alt, depth + 1))
			const next: string[] = []
			for (const prefix of acc)
				for (const part of parts) next.push(prefix + part)
			if (next.length > MAX_EXPANSION) throw new Error("expansionTooLarge")
			acc = next
		}
		return acc
	}

	const expandStrings = (nodes: HassilNodeType[], depth: number): string[] => [
		...new Set(rawStrings(nodes, depth).map(normalizeSpace)),
	]

	const edgeSpaceOf = (
		node: HassilNodeType,
	): { before: boolean; after: boolean } | null => {
		try {
			const raw = rawStrings([node], 0)
			if (raw.every((s) => s.trim().length === 0)) return null
			return {
				before: raw.every((s) => s.length === 0 || /^\s/.test(s)),
				after: raw.every((s) => s.length === 0 || /\s$/.test(s)),
			}
		} catch {
			return null
		}
	}

	const stringsToNodes = (strings: string[]): HaDescriptorNodeType[] => {
		const optional = strings.includes("")
		const alternatives = strings.filter((s) => s.length > 0)
		if (alternatives.length === 0) return []
		const inner: HaDescriptorNodeType[] =
			alternatives.length === 1
				? [{ kind: "text", value: alternatives[0] }]
				: [
						{
							kind: "group",
							alternatives: alternatives.map((value) => [
								{ kind: "text", value },
							]),
						},
					]
		return optional ? [{ kind: "optional", body: inner }] : inner
	}

	const mapSlot = (
		node: Extract<HassilNodeType, { kind: "slot" }>,
		entityKey: string | null,
	): HaDescriptorNodeType => {
		if (node.list === "name") {
			if (!entityKey) throw new Error("slotGlued: {name} outside a block")
			slotSpecs.set(ENTITY_SLOT, {
				source: { kind: "context", key: entityKey },
			})
			return { kind: "slot", name: ENTITY_SLOT }
		}
		if (node.list === "area" || node.list === "floor") {
			slotSpecs.set(node.list, { source: { kind: "context", key: node.list } })
			return { kind: "slot", name: node.list }
		}
		const list = lists.get(node.list)
		if (!list) throw new Error(`unknownList: {${node.list}}`)
		const name = camelCase(node.list)
		const spec: FastPathSlotType =
			list.kind === "range"
				? {
						source: { kind: "range", min: list.min, max: list.max },
						arg: node.arg,
					}
				: {
						source: {
							kind: "map",
							values: list.values.map((v) => ({
								in: expandStrings(parseHassil(v.in), 0).filter(
									(s) => s.length > 0,
								),
								out: LIST_ARGS.has(node.arg) ? [v.out] : v.out,
							})),
						},
						arg: node.arg,
					}
		const existing = slotSpecs.get(name)
		if (existing && JSON.stringify(existing) !== JSON.stringify(spec))
			throw new Error(`unknownList: slot ${name} conflicts`)
		slotSpecs.set(name, spec)
		return { kind: "slot", name }
	}

	const atomsOf = (
		nodes: HassilNodeType[],
	): { node: HassilNodeType; glued: boolean }[] => {
		const atoms: { node: HassilNodeType; glued: boolean }[] = []
		let boundary = true
		for (const node of nodes) {
			if (node.kind !== "text") {
				const edge = edgeSpaceOf(node)
				atoms.push({
					node,
					glued: !boundary && atoms.length > 0 && !(edge?.before ?? false),
				})
				boundary = edge?.after ?? false
				continue
			}
			const leading = /^\s/.test(node.value)
			const trailing = /\s$/.test(node.value)
			const words = node.value.split(/\s+/).filter((w) => w.length > 0)
			words.forEach((word, k) =>
				atoms.push({
					node: { kind: "text", value: word },
					glued: k === 0 ? !boundary && !leading && atoms.length > 0 : false,
				}),
			)
			boundary = trailing || words.length === 0
		}
		return atoms
	}

	const normalizeSequence = (
		nodes: HassilNodeType[],
		entityKey: string | null,
	): HaDescriptorNodeType[] => {
		const atoms = atomsOf(nodes)
		const runs: HassilNodeType[][] = []
		for (const atom of atoms) {
			if (atom.glued && runs.length > 0) runs[runs.length - 1].push(atom.node)
			else runs.push([atom.node])
		}
		const out: HaDescriptorNodeType[] = []
		for (const run of runs) {
			if (run.length === 1) {
				out.push(...normalizeNode(run[0], entityKey))
				continue
			}
			let piece: HassilNodeType[] = []
			const flushPiece = (): void => {
				if (piece.length === 0) return
				if (containsSlot(piece)) throw new Error("slotGlued")
				out.push(...stringsToNodes(expandStrings(piece, 0)))
				piece = []
			}
			for (const node of run) {
				if (node.kind === "slot") {
					flushPiece()
					out.push(mapSlot(node, entityKey))
				} else piece.push(node)
			}
			flushPiece()
		}
		return out
	}

	const normalizeNode = (
		node: HassilNodeType,
		entityKey: string | null,
	): HaDescriptorNodeType[] => {
		if (node.kind === "text") return [{ kind: "text", value: node.value }]
		if (node.kind === "slot") return [mapSlot(node, entityKey)]
		if (node.kind === "rule") {
			convertRule(node.name)
			return [{ kind: "rule", name: node.name }]
		}
		if (node.kind === "optional")
			return [
				{ kind: "optional", body: normalizeSequence(node.body, entityKey) },
			]
		return [
			{
				kind: "group",
				alternatives: node.alternatives.map((alt) =>
					normalizeSequence(alt, entityKey),
				),
			},
		]
	}

	const convertRule = (name: string): HaDescriptorNodeType[] => {
		const cached = convertedRules.get(name)
		if (cached) return cached
		const converted = normalizeSequence(ruleBody(name), null)
		convertedRules.set(name, converted)
		return converted
	}

	const serialize = (nodes: HaDescriptorNodeType[]): string =>
		nodes
			.map((node) => {
				if (node.kind === "text") return node.value
				if (node.kind === "slot") return `{${node.name}}`
				if (node.kind === "rule") return `<${node.name}>`
				if (node.kind === "optional") return `[${serialize(node.body)}]`
				const alternatives = node.alternatives.flatMap((alt) => {
					const only = alt.length === 1 ? alt[0] : null
					return only?.kind === "group" ? only.alternatives : [alt]
				})
				return `(${alternatives.map(serialize).join("|")})`
			})
			.join(" ")

	const wordsOf = (nodes: HaDescriptorNodeType[], depth: number): string[] =>
		nodes.flatMap((node) => {
			if (node.kind === "slot") return []
			if (node.kind === "text") return node.value.split(" ")
			if (node.kind === "rule")
				return depth > MAX_RULE_DEPTH
					? []
					: wordsOf(convertRule(node.name), depth + 1)
			if (node.kind === "optional") return wordsOf(node.body, depth + 1)
			return node.alternatives.flatMap((alt) => wordsOf(alt, depth + 1))
		})

	const nodeHasLiteral = (
		node: HaDescriptorNodeType,
		depth: number,
	): boolean => {
		if (node.kind === "text") return true
		if (node.kind === "rule")
			return (
				depth <= MAX_RULE_DEPTH &&
				hasRequiredLiteral(convertRule(node.name), depth + 1)
			)
		if (node.kind === "group")
			return node.alternatives.every((alt) =>
				hasRequiredLiteral(alt, depth + 1),
			)
		return false
	}

	const hasRequiredLiteral = (
		nodes: HaDescriptorNodeType[],
		depth = 0,
	): boolean => nodes.some((node) => nodeHasLiteral(node, depth))

	const strongOptionalIndex = (nodes: HaDescriptorNodeType[]): number =>
		nodes.findIndex(
			(node) =>
				node.kind === "optional" &&
				wordsOf(node.body, 0).some((w) => !particles.has(w.toLowerCase())),
		)

	const ensureLiteral = (
		nodes: HaDescriptorNodeType[],
	): { nodes: HaDescriptorNodeType[]; rewritten: boolean } => {
		let current = nodes
		let rewritten = false
		for (;;) {
			if (hasRequiredLiteral(current)) return { nodes: current, rewritten }
			const index = strongOptionalIndex(current)
			if (index < 0) throw new Error("noLiteral")
			const optional = current[index]
			if (optional.kind !== "optional") throw new Error("noLiteral")
			current = [
				...current.slice(0, index),
				...optional.body,
				...current.slice(index + 1),
			]
			rewritten = true
		}
	}

	const slotNamesIn = (nodes: FastPathAstNodeType[]): string[] =>
		nodes.flatMap((node) => {
			if (node.kind === "slot") return [node.name]
			if (node.kind === "optional") return slotNamesIn(node.body)
			if (node.kind === "group") return node.alternatives.flatMap(slotNamesIn)
			return []
		})

	const ruleNamesIn = (template: string, acc: Set<string>): Set<string> => {
		for (const match of template.matchAll(/<([^>]+)>/g)) {
			const name = match[1].trim()
			if (acc.has(name)) continue
			acc.add(name)
			ruleNamesIn(serialize(convertRule(name)), acc)
		}
		return acc
	}

	const emittedRules = (): Record<string, string> =>
		Object.fromEntries(
			[...convertedRules.entries()].map(([name, nodes]) => [
				name,
				serialize(nodes),
			]),
		)

	return {
		slotSpecs,
		serialize,
		ensureLiteral,
		slotNamesIn,
		ruleNamesIn,
		emittedRules,
		convertTemplate: (
			src: string,
			entityKey: string | null,
		): HaDescriptorNodeType[] => normalizeSequence(parseHassil(src), entityKey),
	}
}

const entityKeyOf = (
	nameDomains: string | string[] | null,
	declared: string[],
): string | null => {
	const useDefault = nameDomains === null || nameDomains === DEFAULT_NAME_GROUP
	if (useDefault && declared.length === 0)
		return `${ENTITY_KEY_PREFIX}${DEFAULT_NAME_GROUP}`
	const listed = useDefault
		? declared
		: Array.isArray(nameDomains)
			? nameDomains
			: [nameDomains]
	const domains = [...new Set(listed.filter((d) => d !== MEDIA_DOMAIN))].sort()
	return domains.length > 0 ? `${ENTITY_KEY_PREFIX}${domains.join(",")}` : null
}

const dropReasonOf = (error: unknown): HaDescriptorTemplateDropReasonType => {
	const message = error instanceof Error ? error.message : String(error)
	const known: HaDescriptorTemplateDropReasonType[] = [
		"noLiteral",
		"unknownList",
		"unknownRule",
		"permutationTooLarge",
		"expansionTooLarge",
		"slotGlued",
	]
	const hit = known.find((k) => message.startsWith(k))
	if (hit) return hit
	if (message.includes("required literal")) return "noLiteral"
	if (message.includes("fast-path")) return "lintError"
	return "parseError"
}

const emptyIntentReport = (): HaDescriptorIntentReportType => ({
	blocksKept: 0,
	blocksSkipped: {
		speechToPhrase: 0,
		contextArea: 0,
		houseWide: 0,
		mediaOnly: 0,
		noSentences: 0,
	},
	templatesKept: 0,
	templatesRewritten: 0,
	templatesDropped: {
		noLiteral: 0,
		parseError: 0,
		lintError: 0,
		unknownList: 0,
		unknownRule: 0,
		permutationTooLarge: 0,
		expansionTooLarge: 0,
		slotGlued: 0,
		noTargetSlot: 0,
		duplicate: 0,
	},
	droppedSamples: [],
})

const astKeyOf = (src: string, rules: Record<string, string>): string =>
	JSON.stringify(parseTemplate(src, rules))

const signatureOf = (
	tool: string,
	slots: Record<string, FastPathSlotType>,
	argDefaults: Record<string, unknown> | null,
): string => JSON.stringify([tool, slots, argDefaults])

const loadBase = (language: string): FastPathBlockType => {
	const file = join(DESCRIPTORS_DIR, "base", `${language}.json`)
	const parsed = domiaSkillDescriptorSchema.parse(
		JSON.parse(readFileSync(file, "utf8")),
	)
	if (!parsed.fastPath)
		throw new Error(`base descriptor ${file} has no fastPath`)
	return parsed.fastPath
}

const generateLanguage = async (
	language: string,
	combinations: Map<string, Map<string, HaCorpusCombinationType>>,
	commit: string,
): Promise<HaDescriptorLanguageReportType> => {
	const rules = loadRules(language)
	const lists = loadLists(language)
	const blocks = loadBlocks(language)
	const converter = createConverter(language, rules, lists)
	const report: HaDescriptorLanguageReportType = {
		language,
		intents: 0,
		templates: 0,
		baseTemplates: 0,
		baseDuplicates: [],
		rules: 0,
		ruleCollisions: [],
		byIntent: {},
	}
	const reportFor = (intent: string): HaDescriptorIntentReportType => {
		if (!Object.hasOwn(report.byIntent, intent))
			report.byIntent[intent] = emptyIntentReport()
		return report.byIntent[intent]
	}
	const skip = (
		intent: string,
		reason: HaDescriptorBlockSkipReasonType,
	): void => {
		reportFor(intent).blocksSkipped[reason]++
	}
	for (const intent of SCOPE)
		if (!blocks.some((b) => b.intent === intent)) skip(intent, "noSentences")

	const drafts = new Map<string, HaDescriptorDraftType>()
	const draftOrder: string[] = []
	for (const block of blocks) {
		const combo = combinations.get(block.intent)?.get(block.combination)
		const contextArea = combo?.contextArea ?? false
		const comboSlots = combo?.slots ?? []
		if (block.speechToPhrase) {
			skip(block.intent, "speechToPhrase")
			continue
		}
		if (contextArea && !INCLUDE_CONTEXT_AREA) {
			skip(block.intent, "contextArea")
			continue
		}
		if (!contextArea && !comboSlots.some((s) => TARGET_SLOTS.includes(s))) {
			skip(block.intent, "houseWide")
			continue
		}
		const entityKey = entityKeyOf(block.nameDomains, combo?.nameDomains ?? [])
		if (comboSlots.includes("name") && !entityKey) {
			skip(block.intent, "mediaOnly")
			continue
		}
		const intentReport = reportFor(block.intent)
		intentReport.blocksKept++
		const argDefaults = block.inferredDomain
			? { domain: [block.inferredDomain] }
			: null
		for (const sentence of block.sentences) {
			try {
				const converted = converter.convertTemplate(sentence, entityKey)
				const { nodes, rewritten } = converter.ensureLiteral(converted)
				const source = converter.serialize(nodes)
				const emitted = converter.emittedRules()
				const ast = parseTemplate(source, emitted)
				lintTemplate(ast, source)
				const slotNames = [...new Set(converter.slotNamesIn(ast))]
				if (
					!contextArea &&
					!slotNames.some((s) => TARGET_SLOTS.includes(s) || s === ENTITY_SLOT)
				)
					throw new Error("noTargetSlot")
				const slots: Record<string, FastPathSlotType> = {}
				for (const name of slotNames.sort()) {
					const spec = converter.slotSpecs.get(name)
					if (!spec) throw new Error(`unknownList: slot ${name} has no spec`)
					slots[name] =
						name === ENTITY_SLOT && entityKey
							? { source: { kind: "context", key: entityKey } }
							: spec
				}
				const priority = slotNames.includes(ENTITY_SLOT) ? 1 : 0
				const signature = signatureOf(block.intent, slots, argDefaults)
				const draft: HaDescriptorDraftType = drafts.get(signature) ?? {
					tool: block.intent,
					slots,
					argDefaults,
					priority,
					templates: [],
				}
				if (!drafts.has(signature)) {
					drafts.set(signature, draft)
					draftOrder.push(signature)
				}
				const astKey = JSON.stringify(ast)
				if (draft.templates.some((t) => t.astKey === astKey)) {
					intentReport.templatesDropped.duplicate++
					continue
				}
				draft.templates.push({ source, astKey })
				intentReport.templatesKept++
				if (rewritten) intentReport.templatesRewritten++
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				const reason =
					message === "noTargetSlot" ? "noTargetSlot" : dropReasonOf(error)
				intentReport.templatesDropped[reason]++
				if (intentReport.droppedSamples.length < MAX_DROPPED_SAMPLES)
					intentReport.droppedSamples.push(
						`${reason}: ${sentence} — ${message.slice(0, 120)}`,
					)
			}
		}
	}

	const generatedIntents: FastPathIntentType[] = draftOrder.map((signature) => {
		const draft = drafts.get(signature)
		if (!draft) throw new Error("draft vanished")
		return {
			tool: draft.tool,
			...(draft.priority > 0 ? { priority: draft.priority } : {}),
			templates: draft.templates.map((t) => t.source),
			slots: draft.slots,
			...(draft.argDefaults ? { argDefaults: draft.argDefaults } : {}),
		}
	})

	const referenced = new Set<string>()
	for (const intent of generatedIntents)
		for (const template of intent.templates)
			converter.ruleNamesIn(template, referenced)
	const generatedRules = Object.fromEntries(
		Object.entries(converter.emittedRules()).filter(([name]) =>
			referenced.has(name),
		),
	)

	const base = loadBase(language)
	const baseRules = base.expansionRules ?? {}
	for (const [name, body] of Object.entries(baseRules))
		if (Object.hasOwn(generatedRules, name) && generatedRules[name] !== body)
			report.ruleCollisions.push(
				`${name}: base "${body}" → corpus "${generatedRules[name]}"`,
			)
	const mergedRules = { ...baseRules, ...generatedRules }
	const generatedKeys = new Map<string, Set<string>>()
	for (const intent of generatedIntents) {
		const keys = generatedKeys.get(intent.tool) ?? new Set<string>()
		for (const template of intent.templates)
			keys.add(astKeyOf(template, mergedRules))
		generatedKeys.set(intent.tool, keys)
	}
	const baseIntents = base.intents.flatMap((intent) => {
		const templates = intent.templates.filter((template) => {
			const duplicate = generatedKeys
				.get(intent.tool)
				?.has(astKeyOf(template, mergedRules))
			if (duplicate) report.baseDuplicates.push(`${intent.tool}: ${template}`)
			return !duplicate
		})
		report.baseTemplates += templates.length
		return templates.length > 0 ? [{ ...intent, templates }] : []
	})

	const intents = [...baseIntents, ...generatedIntents]
	const rulesSorted = Object.fromEntries(
		Object.keys(mergedRules)
			.sort()
			.map((k) => [k, mergedRules[k]]),
	)
	for (const intent of intents)
		for (const template of intent.templates)
			lintTemplate(parseTemplate(template, rulesSorted), template)
	const descriptor = {
		version: 1,
		kind: "home-assistant",
		description: `Fast-path templates: hand-written base plus OHF-Voice/intents @${commit} (CC-BY-4.0), generated by evals/gen-ha-descriptors.ts`,
		fastPath: { expansionRules: rulesSorted, intents },
	}
	domiaSkillDescriptorSchema.parse(descriptor)
	await writeFormattedJson(
		join(DESCRIPTORS_DIR, `${language}.json`),
		descriptor,
	)
	report.intents = intents.length
	report.templates = intents.reduce((n, i) => n + i.templates.length, 0)
	report.rules = Object.keys(rulesSorted).length
	return report
}

const printReport = (report: HaDescriptorLanguageReportType): void => {
	console.log(
		`\n${report.language}: ${report.intents} intents · ${report.templates} templates (${report.baseTemplates} base) · ${report.rules} rules`,
	)
	if (report.baseDuplicates.length > 0)
		console.log(
			`  base duplicates dropped: ${report.baseDuplicates.join(" | ")}`,
		)
	if (report.ruleCollisions.length > 0)
		console.log(
			`  rule collisions (corpus wins): ${report.ruleCollisions.join(" | ")}`,
		)
	console.log(
		"  intent | blocks kept | skipped (s2p/ctx/house/media/none) | kept | rewritten | dropped",
	)
	for (const [intent, r] of Object.entries(report.byIntent)) {
		const skipped = r.blocksSkipped
		const dropped = Object.entries(r.templatesDropped)
			.filter(([, n]) => n > 0)
			.map(([k, n]) => `${k}=${n}`)
			.join(",")
		console.log(
			`  ${intent.padEnd(26)} ${String(r.blocksKept).padStart(3)} | ${skipped.speechToPhrase}/${skipped.contextArea}/${skipped.houseWide}/${skipped.mediaOnly}/${skipped.noSentences} | ${String(r.templatesKept).padStart(3)} | ${String(r.templatesRewritten).padStart(3)} | ${dropped || "-"}`,
		)
		for (const sample of r.droppedSamples) console.log(`      ↳ ${sample}`)
	}
}

const main = async (): Promise<void> => {
	if (!existsSync(join(CORPUS_DIR, "intents.yaml")))
		throw new Error(`no intents corpus at ${CORPUS_DIR} (set HA_INTENTS_DIR)`)
	const commit = corpusCommit()
	const combinations = loadCombinations()
	for (const language of LANGUAGES)
		printReport(await generateLanguage(language, combinations, commit))
	console.log(`\ncorpus ${commit} → ${DESCRIPTORS_DIR}`)
}

void main()
