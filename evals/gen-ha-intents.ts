import { execFileSync } from "node:child_process"
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { join, resolve } from "node:path"

import { parse } from "yaml"
import { z } from "zod"

import { writeFormattedJson } from "./lib/format"
import {
	HA_INTENTS_FIXTURES_DIR,
	expectedCallOf,
	foldForComparison,
	haIntentScopeOf,
} from "./lib/ha-intents-corpus"
import type {
	HaIntentScopeType,
	HaIntentsEntityType,
	HaIntentsMetaType,
	HaIntentsRowType,
	HaIntentsSiteType,
	HaIntentsTemplateBlockType,
	HaIntentsTemplatesType,
} from "./types"

const LANGUAGES = ["en", "es"]
const CORPUS_DIR = resolve(
	process.env.HA_INTENTS_DIR ?? "../project-references/intents",
)
const FIXTURES_FILE = "_fixtures.yaml"

const scalar = z.union([z.string(), z.number(), z.boolean()])

const stateSchema = z.union([
	scalar,
	z.looseObject({ in: scalar.optional(), out: scalar.optional() }),
])

const nameSchema = z.union([z.string(), z.number()]).transform(String)

const rawEntitySchema = z.looseObject({
	name: nameSchema,
	domain: z.string().optional(),
	id: z.string().optional(),
	area: z.string().optional().nullable(),
	state: stateSchema.optional().nullable(),
	attributes: z.looseObject({ device_class: z.string().optional() }).optional(),
})

const rawAreaSchema = z.looseObject({
	name: nameSchema,
	id: z.string().optional(),
	floor: z.string().optional().nullable(),
})

const rawFloorSchema = z.looseObject({
	name: nameSchema,
	id: z.string().optional(),
})

const rawTestSchema = z.looseObject({
	sentences: z.array(z.string()),
	slots: z.record(z.string(), z.unknown()).optional().nullable(),
})

const rawTestFileSchema = z.looseObject({
	language: z.string(),
	tests: z.array(rawTestSchema),
	entities: z.array(rawEntitySchema).optional().nullable(),
	areas: z.array(rawAreaSchema).optional().nullable(),
	floors: z.array(rawFloorSchema).optional().nullable(),
})

const rawFixturesSchema = z.looseObject({
	language: z.string(),
	floors: z.array(rawFloorSchema).optional().nullable(),
	areas: z.array(rawAreaSchema).optional().nullable(),
	entities: z.array(rawEntitySchema).optional().nullable(),
})

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

const rawListsFileSchema = z.looseObject({
	lists: z.record(z.string(), z.unknown()).optional().nullable(),
})

const rawIntentsSchema = z.record(
	z.string(),
	z.looseObject({
		slot_combinations: z
			.record(
				z.string(),
				z.looseObject({ context_area: z.boolean().optional().nullable() }),
			)
			.optional()
			.nullable(),
	}),
)

const readYaml = (file: string): unknown =>
	parse(readFileSync(file, "utf8")) as unknown

const yamlFilesIn = (dir: string): string[] =>
	existsSync(dir)
		? readdirSync(dir)
				.filter((f) => f.endsWith(".yaml") && statSync(join(dir, f)).isFile())
				.sort()
		: []

const subdirsIn = (dir: string): string[] =>
	existsSync(dir)
		? readdirSync(dir)
				.filter((d) => statSync(join(dir, d)).isDirectory())
				.sort()
		: []

const stemOf = (file: string): string => file.replace(/\.yaml$/, "")

const contextAreaCombos = (): Map<string, Set<string>> => {
	const intents = rawIntentsSchema.parse(
		readYaml(join(CORPUS_DIR, "intents.yaml")),
	)
	const out = new Map<string, Set<string>>()
	for (const [intent, spec] of Object.entries(intents)) {
		const combos = Object.entries(spec.slot_combinations ?? {})
			.filter(([, c]) => c.context_area === true)
			.map(([name]) => name)
		if (combos.length > 0) out.set(intent, new Set(combos))
	}
	return out
}

const corpusMeta = (): HaIntentsMetaType => ({
	source: "https://github.com/OHF-Voice/intents",
	commit: execFileSync(
		"git",
		["-C", CORPUS_DIR, "rev-parse", "--short", "HEAD"],
		{
			encoding: "utf8",
		},
	).trim(),
	license: "CC-BY-4.0",
	generatedBy: "evals/gen-ha-intents.ts",
})

const createSiteBuilder = (
	language: string,
): {
	addFloor: (name: string) => void
	addArea: (name: string, floor: string | null) => void
	addEntity: (entity: Omit<HaIntentsEntityType, "floor">) => void
	build: () => HaIntentsSiteType
} => {
	const floors = new Map<string, string>()
	const areas = new Map<string, string>()
	const areaFloor = new Map<string, string>()
	const entities = new Map<string, Omit<HaIntentsEntityType, "floor">>()
	const addFloor = (name: string): void => {
		const key = foldForComparison(name)
		if (!floors.has(key)) floors.set(key, name)
	}
	const addArea = (name: string, floor: string | null): void => {
		const key = foldForComparison(name)
		if (!areas.has(key)) areas.set(key, name)
		if (floor) {
			addFloor(floor)
			if (!areaFloor.has(key)) areaFloor.set(key, floor)
		}
	}
	return {
		addFloor,
		addArea,
		addEntity: (entity) => {
			const key = `${foldForComparison(entity.name)}|${entity.domain}`
			if (!entities.has(key)) entities.set(key, entity)
			if (entity.area) addArea(entity.area, null)
		},
		build: () => ({
			language,
			floors: [...floors.values()],
			areas: [...areas.values()],
			entities: [...entities.values()].map((e) => ({
				name: e.name,
				domain: e.domain,
				area: e.area,
				floor: e.area
					? (areaFloor.get(foldForComparison(e.area)) ?? null)
					: null,
				deviceClass: e.deviceClass,
				state: e.state,
			})),
		}),
	}
}

const stateOf = (
	value: z.infer<typeof stateSchema> | null | undefined,
): string | null => {
	if (value === undefined || value === null) return null
	if (typeof value === "object") {
		const spoken = value.in ?? value.out
		return spoken === undefined ? null : String(spoken)
	}
	return String(value)
}

const domainOfId = (id: string): string => id.split(".")[0]

const loadFixtures = (
	language: string,
	site: ReturnType<typeof createSiteBuilder>,
): Map<string, string> => {
	const byName = new Map<string, string>()
	const file = join(CORPUS_DIR, "tests", language, FIXTURES_FILE)
	if (!existsSync(file)) return byName
	const fixtures = rawFixturesSchema.parse(readYaml(file))
	const floorNames = new Map<string, string>()
	for (const floor of fixtures.floors ?? []) {
		site.addFloor(floor.name)
		if (floor.id) floorNames.set(floor.id, floor.name)
	}
	const areaNames = new Map<string, string>()
	for (const area of fixtures.areas ?? []) {
		const floor = area.floor ? (floorNames.get(area.floor) ?? area.floor) : null
		site.addArea(area.name, floor)
		if (area.id) areaNames.set(area.id, area.name)
	}
	for (const entity of fixtures.entities ?? []) {
		const domain = entity.domain ?? (entity.id ? domainOfId(entity.id) : "")
		if (!domain) continue
		site.addEntity({
			name: entity.name,
			domain,
			area: entity.area ? (areaNames.get(entity.area) ?? entity.area) : null,
			deviceClass: entity.attributes?.device_class ?? null,
			state: stateOf(entity.state),
		})
		byName.set(foldForComparison(entity.name), domain)
	}
	return byName
}

const buildRowsAndSite = (
	language: string,
	contextArea: Map<string, Set<string>>,
): { rows: HaIntentsRowType[]; site: HaIntentsSiteType } => {
	const site = createSiteBuilder(language)
	const fixtureDomains = loadFixtures(language, site)
	const rows: HaIntentsRowType[] = []
	const testsDir = join(CORPUS_DIR, "tests", language)
	for (const intent of subdirsIn(testsDir)) {
		const scope: HaIntentScopeType = haIntentScopeOf(intent)
		const combos = contextArea.get(intent) ?? new Set<string>()
		for (const file of yamlFilesIn(join(testsDir, intent))) {
			if (file === FIXTURES_FILE) continue
			const combination = stemOf(file)
			const parsed = rawTestFileSchema.parse(
				readYaml(join(testsDir, intent, file)),
			)
			for (const floor of parsed.floors ?? []) site.addFloor(floor.name)
			for (const area of parsed.areas ?? [])
				site.addArea(area.name, area.floor ?? null)
			const localDomains = new Map<string, string>()
			for (const entity of parsed.entities ?? []) {
				const domain = entity.domain ?? (entity.id ? domainOfId(entity.id) : "")
				if (!domain) continue
				site.addEntity({
					name: entity.name,
					domain,
					area: entity.area ?? null,
					deviceClass: entity.attributes?.device_class ?? null,
					state: stateOf(entity.state),
				})
				localDomains.set(foldForComparison(entity.name), domain)
			}
			parsed.tests.forEach((test, i) => {
				const slots = test.slots ?? {}
				const slotName = typeof slots.name === "string" ? slots.name : null
				const entityDomain = slotName
					? (localDomains.get(foldForComparison(slotName)) ??
						fixtureDomains.get(foldForComparison(slotName)) ??
						null)
					: null
				test.sentences.forEach((text, j) => {
					rows.push({
						id: `${language}:${intent}:${combination}:${i}:${j}`,
						language,
						intent,
						combination,
						text,
						scope,
						contextArea: combos.has(combination),
						entityDomain,
						expect: expectedCallOf(intent, slots),
					})
				})
			})
		}
	}
	return { rows, site: site.build() }
}

const buildTemplates = (
	language: string,
	contextArea: Map<string, Set<string>>,
): HaIntentsTemplatesType => {
	const blocks: HaIntentsTemplateBlockType[] = []
	const sentencesDir = join(CORPUS_DIR, "sentences", language)
	for (const intent of subdirsIn(sentencesDir)) {
		const combos = contextArea.get(intent) ?? new Set<string>()
		for (const file of yamlFilesIn(join(sentencesDir, intent))) {
			const combination = stemOf(file)
			const parsed = rawSentenceFileSchema.parse(
				readYaml(join(sentencesDir, intent, file)),
			)
			for (const block of parsed.data)
				blocks.push({
					intent,
					combination,
					templates: block.sentences,
					nameDomains: block.name_domains ?? null,
					inferredDomain: block.inferred_domain ?? null,
					speechToPhrase: block.speech_to_phrase === true,
					contextArea: combos.has(combination),
				})
		}
	}
	const rules: Record<string, string> = {}
	const rulesDir = join(CORPUS_DIR, "rules", language)
	for (const file of yamlFilesIn(rulesDir)) {
		const parsed = rawRulesFileSchema.parse(readYaml(join(rulesDir, file)))
		Object.assign(rules, parsed.expansion_rules ?? {})
	}
	const listNames = new Set<string>()
	for (const dir of [
		join(CORPUS_DIR, "lists"),
		join(CORPUS_DIR, "lists", language),
	])
		for (const file of yamlFilesIn(dir)) {
			const parsed = rawListsFileSchema.parse(readYaml(join(dir, file)))
			for (const name of Object.keys(parsed.lists ?? {})) listNames.add(name)
		}
	return {
		language,
		rules: Object.fromEntries(
			Object.keys(rules)
				.sort()
				.map((k) => [k, rules[k]]),
		),
		lists: [...listNames].sort(),
		blocks,
	}
}

const writeJson = (file: string, value: unknown): Promise<void> =>
	writeFormattedJson(join(HA_INTENTS_FIXTURES_DIR, file), value)

const countByScope = (
	rows: HaIntentsRowType[],
): Record<HaIntentScopeType, number> => {
	const out: Record<HaIntentScopeType, number> = {
		action: 0,
		read: 0,
		builtin: 0,
		excluded: 0,
	}
	for (const row of rows) out[row.scope]++
	return out
}

const main = async (): Promise<void> => {
	if (!existsSync(join(CORPUS_DIR, "intents.yaml")))
		throw new Error(`no intents corpus at ${CORPUS_DIR} (set HA_INTENTS_DIR)`)
	mkdirSync(HA_INTENTS_FIXTURES_DIR, { recursive: true })
	const meta = corpusMeta()
	const contextArea = contextAreaCombos()
	for (const language of LANGUAGES) {
		const { rows, site } = buildRowsAndSite(language, contextArea)
		const templates = buildTemplates(language, contextArea)
		await writeJson(`${language}.json`, { meta, rows })
		await writeJson(`site-${language}.json`, { meta, ...site })
		await writeJson(`templates-${language}.json`, { meta, ...templates })
		const counts = countByScope(rows)
		console.log(
			`${language}: ${rows.length} sentences — action ${counts.action} · read ${counts.read} · builtin ${counts.builtin} · excluded ${counts.excluded} · site ${site.entities.length} entities / ${site.areas.length} areas / ${site.floors.length} floors · templates ${templates.blocks.length} blocks / ${Object.keys(templates.rules).length} rules / ${templates.lists.length} lists`,
		)
	}
	const baseline = join(HA_INTENTS_FIXTURES_DIR, "baseline.json")
	if (!existsSync(baseline)) writeFileSync(baseline, "{}\n")
	console.log(`corpus ${meta.commit} → ${HA_INTENTS_FIXTURES_DIR}`)
}

void main()
