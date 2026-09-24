import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import { foldText } from "@/utils/text-tokens"

import type {
	HaExpectedArgValueType,
	HaExpectedCallType,
	HaIntentScopeType,
	HaIntentsBaselineType,
	HaIntentsRowsFileType,
	HaIntentsSiteFileType,
	HaIntentsSiteType,
	HaIntentsTemplatesFileType,
	HaSlotComparisonType,
	MockHaEntityType,
} from "../types"

export const HA_INTENTS_FIXTURES_DIR = join(
	process.cwd(),
	"evals",
	"fixtures",
	"ha-intents",
)

export const HA_READ_TOOL = "GetLiveContext"

export const HA_INTENT_SCOPE: Record<string, HaIntentScopeType> = {
	HassTurnOn: "action",
	HassTurnOff: "action",
	HassSetPosition: "action",
	HassStopMoving: "action",
	HassCancelAllTimers: "excluded",
	HassLightSet: "action",
	HassClimateSetTemperature: "action",
	HassClimateSetFanMode: "action",
	HassFanSetSpeed: "action",
	HassHumidifierSetpoint: "action",
	HassHumidifierMode: "action",
	HassVacuumStart: "action",
	HassVacuumReturnToBase: "action",
	HassVacuumCleanArea: "action",
	HassLawnMowerDock: "action",
	HassLawnMowerStartMowing: "action",
	HassListAddItem: "action",
	HassListCompleteItem: "action",
	HassListRemoveItem: "action",
	HassGetState: "read",
	HassClimateGetTemperature: "read",
	HassGetCurrentTime: "builtin",
	HassGetCurrentDate: "builtin",
	HassBroadcast: "excluded",
	HassCancelTimer: "excluded",
	HassDecreaseTimer: "excluded",
	HassIncreaseTimer: "excluded",
	HassPauseTimer: "excluded",
	HassStartTimer: "excluded",
	HassTimerStatus: "excluded",
	HassUnpauseTimer: "excluded",
	HassGetWeather: "excluded",
	HassMediaNext: "excluded",
	HassMediaPause: "excluded",
	HassMediaPlayerMute: "excluded",
	HassMediaPlayerUnmute: "excluded",
	HassMediaPrevious: "excluded",
	HassMediaSearchAndPlay: "excluded",
	HassMediaUnpause: "excluded",
	HassSetVolume: "excluded",
	HassSetVolumeRelative: "excluded",
	HassNevermind: "excluded",
	HassRespond: "excluded",
	HassShoppingListAddItem: "excluded",
	HassShoppingListCompleteItem: "excluded",
}

export const haIntentScopeOf = (intent: string): HaIntentScopeType =>
	HA_INTENT_SCOPE[intent] ?? "excluded"

export const HA_TARGETED_TOOLS: ReadonlySet<string> = new Set([
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
	"HassVacuumCleanArea",
	"HassLawnMowerDock",
	"HassLawnMowerStartMowing",
])

export const HA_TARGET_SLOTS = ["name", "area", "floor"] as const

const LIST_SLOTS = new Set(["domain", "device_class"])
const NUMERIC_SLOTS = new Set([
	"brightness",
	"temperature",
	"position",
	"percentage",
	"humidity",
])
const TEXT_SLOTS = new Set([
	...HA_TARGET_SLOTS,
	"color",
	"fan_mode",
	"mode",
	"item",
])

export const foldForComparison = (text: string): string =>
	foldText(text)
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()

const expectedArgOf = (
	slot: string,
	value: unknown,
): HaExpectedArgValueType | null => {
	if (LIST_SLOTS.has(slot)) return typeof value === "string" ? [value] : null
	if (NUMERIC_SLOTS.has(slot)) {
		const n = Number(value)
		return Number.isFinite(n) ? n : null
	}
	if (TEXT_SLOTS.has(slot)) return typeof value === "string" ? value : null
	return null
}

export const expectedCallOf = (
	intent: string,
	slots: Record<string, unknown>,
): HaExpectedCallType => {
	const scope = haIntentScopeOf(intent)
	if (scope === "read") return { tool: HA_READ_TOOL, args: {} }
	if (scope !== "action") return { tool: null, args: {} }
	const args: Record<string, HaExpectedArgValueType> = {}
	for (const [slot, value] of Object.entries(slots)) {
		const mapped = expectedArgOf(slot, value)
		if (mapped !== null) args[slot] = mapped
	}
	return { tool: intent, args }
}

const asFoldedSet = (value: unknown): Set<string> | null => {
	if (typeof value === "string") return new Set([foldForComparison(value)])
	if (Array.isArray(value))
		return new Set(
			value
				.filter((v): v is string => typeof v === "string")
				.map(foldForComparison),
		)
	return null
}

const sameSet = (a: Set<string>, b: Set<string>): boolean =>
	a.size === b.size && [...a].every((v) => b.has(v))

const argMatches = (
	slot: string,
	expected: HaExpectedArgValueType,
	actual: unknown,
): boolean => {
	if (LIST_SLOTS.has(slot)) {
		const e = asFoldedSet(expected)
		const a = asFoldedSet(actual)
		return e !== null && a !== null && sameSet(e, a)
	}
	if (typeof expected === "number") return Number(actual) === expected
	if (typeof actual !== "string" && typeof actual !== "number") return false
	return (
		foldForComparison(String(expected)) === foldForComparison(String(actual))
	)
}

const isPresent = (value: unknown): boolean =>
	value !== undefined && value !== null && value !== ""

export const compareSlots = (
	expected: Record<string, HaExpectedArgValueType>,
	resolvedArgs: Record<string, unknown>,
): HaSlotComparisonType => {
	const missing: string[] = []
	const mismatched: string[] = []
	for (const [slot, value] of Object.entries(expected)) {
		if (!isPresent(resolvedArgs[slot])) missing.push(slot)
		else if (!argMatches(slot, value, resolvedArgs[slot])) mismatched.push(slot)
	}
	const extra = Object.entries(resolvedArgs)
		.filter(([slot, value]) => !(slot in expected) && isPresent(value))
		.map(([slot]) => slot)
	return {
		ok: missing.length === 0 && mismatched.length === 0,
		missing,
		mismatched,
		extra,
	}
}

export const hasTargetSlot = (args: Record<string, unknown>): boolean =>
	HA_TARGET_SLOTS.some((slot) => isPresent(args[slot]))

export const haIntentsMetaSchema = z
	.object({
		source: z.string().min(1),
		commit: z.string().min(1),
		license: z.string().min(1),
		generatedBy: z.string().min(1),
	})
	.strict()

const scopeSchema = z.enum(["action", "read", "builtin", "excluded"])

const expectedArgSchema = z.union([z.string(), z.number(), z.array(z.string())])

export const haIntentsRowSchema = z
	.object({
		id: z.string().min(1),
		language: z.string().min(1),
		intent: z.string().min(1),
		combination: z.string().min(1),
		text: z.string().min(1),
		scope: scopeSchema,
		contextArea: z.boolean(),
		entityDomain: z.string().nullable(),
		expect: z
			.object({
				tool: z.string().nullable(),
				args: z.record(z.string(), expectedArgSchema),
			})
			.strict(),
	})
	.strict()

export const haIntentsRowsFileSchema = z
	.object({ meta: haIntentsMetaSchema, rows: z.array(haIntentsRowSchema) })
	.strict()

export const haIntentsEntitySchema = z
	.object({
		name: z.string().min(1),
		domain: z.string().min(1),
		area: z.string().nullable(),
		floor: z.string().nullable(),
		deviceClass: z.string().nullable(),
		state: z.string().nullable(),
	})
	.strict()

export const haIntentsSiteFileSchema = z
	.object({
		meta: haIntentsMetaSchema,
		language: z.string().min(1),
		floors: z.array(z.string()),
		areas: z.array(z.string()),
		entities: z.array(haIntentsEntitySchema),
	})
	.strict()

export const haIntentsTemplateBlockSchema = z
	.object({
		intent: z.string().min(1),
		combination: z.string().min(1),
		templates: z.array(z.string()),
		nameDomains: z.union([z.string(), z.array(z.string())]).nullable(),
		inferredDomain: z.string().nullable(),
		speechToPhrase: z.boolean(),
		contextArea: z.boolean(),
	})
	.strict()

export const haIntentsTemplatesFileSchema = z
	.object({
		meta: haIntentsMetaSchema,
		language: z.string().min(1),
		rules: z.record(z.string(), z.string()),
		lists: z.array(z.string()),
		blocks: z.array(haIntentsTemplateBlockSchema),
	})
	.strict()

export const haIntentsBaselineSchema = z.record(
	z.string(),
	z
		.object({
			matchedCorrect: z.number().int().min(0),
			wrong: z.number().int().min(0),
			falsePositives: z.number().int().min(0),
		})
		.strict(),
)

const readJson = (file: string): unknown =>
	JSON.parse(readFileSync(join(HA_INTENTS_FIXTURES_DIR, file), "utf8"))

export const loadHaIntentsRows = (lang: string): HaIntentsRowsFileType =>
	haIntentsRowsFileSchema.parse(readJson(`${lang}.json`))

export const loadHaIntentsSite = (lang: string): HaIntentsSiteFileType =>
	haIntentsSiteFileSchema.parse(readJson(`site-${lang}.json`))

export const loadHaIntentsTemplates = (
	lang: string,
): HaIntentsTemplatesFileType =>
	haIntentsTemplatesFileSchema.parse(readJson(`templates-${lang}.json`))

export const loadHaIntentsBaseline = (): HaIntentsBaselineType => {
	const file = join(HA_INTENTS_FIXTURES_DIR, "baseline.json")
	if (!existsSync(file)) return {}
	return haIntentsBaselineSchema.parse(readJson("baseline.json"))
}

export const siteToMockEntities = (
	site: HaIntentsSiteType,
): MockHaEntityType[] => {
	const entities: MockHaEntityType[] = site.entities.map((e) => ({
		names: [e.name],
		domain: e.domain,
		area: e.area ?? "",
	}))
	const covered = new Set(
		site.entities
			.map((e) => e.area)
			.filter((a): a is string => a !== null)
			.map(foldForComparison),
	)
	for (const area of site.areas)
		if (!covered.has(foldForComparison(area)))
			entities.push({ names: [`Area Marker ${area}`], domain: "sensor", area })
	return entities
}
