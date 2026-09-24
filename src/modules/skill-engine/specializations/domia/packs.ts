import { z } from "zod"

import { skillEngineLogger, type ResolvedLanguageSetsType } from "@/utils"

import { domiaSkillDescriptorSchema } from "../../schemas"
import type {
	BuiltinToolPackType,
	BuiltinToolType,
	SkillCallResultType,
} from "../../types"

import { DOMIA_PACK_BASE_LANGUAGE, DOMIA_PLACEHOLDER_RE } from "./constants"
import type { DomiaDurationPartType } from "./types"

const fastPathIntentSchema =
	domiaSkillDescriptorSchema.shape.fastPath.unwrap().shape.intents.element

const finalizeRuleSchema = domiaSkillDescriptorSchema.shape.execution
	.unwrap()
	.shape.finalize.unwrap().valueType

const builtinToolPackSchema = z
	.object({
		intents: z.array(fastPathIntentSchema.omit({ tool: true })).optional(),
		expansionRules: z.record(z.string(), z.string()).optional(),
		keywords: z.array(z.string().min(1)).optional(),
		exampleUtterances: z.array(z.string().min(1)).optional(),
		finalize: finalizeRuleSchema,
		phrases: z.record(z.string(), z.string()).optional(),
		confirmSummary: z.string().optional(),
		samples: z
			.array(
				z
					.object({
						text: z.string().min(1),
						args: z.record(z.string(), z.unknown()).optional(),
					})
					.strict(),
			)
			.optional(),
	})
	.strict()

const parsePack = (language: string, raw: unknown): BuiltinToolPackType => {
	const parsed = builtinToolPackSchema.safeParse(raw)
	if (!parsed.success)
		throw new Error(
			`built-in tool pack ${language} is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
		)
	return parsed.data
}

export const builtinToolPacks = (
	raw: Record<string, unknown>,
): Record<string, BuiltinToolPackType> => {
	if (!(DOMIA_PACK_BASE_LANGUAGE in raw))
		throw new Error(
			`built-in tool packs have no ${DOMIA_PACK_BASE_LANGUAGE} language`,
		)
	return Object.fromEntries(
		Object.entries(raw).map(([language, pack]) => [
			language,
			parsePack(language, pack),
		]),
	)
}

export const baseLanguageOf = (language: string | null): string =>
	(language ?? DOMIA_PACK_BASE_LANGUAGE).toLowerCase().split(/[-_]/)[0]

export const packFor = (
	tool: BuiltinToolType,
	language: string | null,
): BuiltinToolPackType =>
	tool.packs[baseLanguageOf(language)] ?? tool.packs[DOMIA_PACK_BASE_LANGUAGE]

export const fillPlaceholders = (
	text: string,
	params: Record<string, unknown>,
): string =>
	text.replace(DOMIA_PLACEHOLDER_RE, (whole, key: string) => {
		const value = params[key]
		return typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean"
			? String(value)
			: whole
	})

export const phrase = (
	sets: ResolvedLanguageSetsType,
	key: string,
	params: Record<string, unknown> = {},
): string => {
	if (!(key in sets.phrases)) {
		skillEngineLogger.warn("built-in phrase missing — speaking its key", {
			key,
			language: sets.locale,
		})
		return key
	}
	return fillPlaceholders(sets.phrases[key], params)
}

const durationParts = (seconds: number): DomiaDurationPartType[] => {
	const hours = Math.floor(seconds / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const rest = seconds % 60
	const parts: DomiaDurationPartType[] = []
	if (hours > 0) parts.push({ amount: hours, unit: "hour" })
	if (minutes > 0) parts.push({ amount: minutes, unit: "minute" })
	if (rest > 0 || parts.length === 0)
		parts.push({ amount: rest, unit: "second" })
	return parts
}

export const durationLabel = (
	seconds: number,
	sets: ResolvedLanguageSetsType,
): string => {
	const units = sets.unitWords
	const words = durationParts(seconds).map(
		({ amount, unit }) =>
			`${amount} ${units[unit]}${amount === 1 ? "" : units.plural}`,
	)
	if (words.length <= 1) return words.join("")
	const joiner = ` ${phrase(sets, "listJoiner")} `
	return `${words.slice(0, -1).join(", ")}${joiner}${words[words.length - 1]}`
}

export const okResult = (
	text: string,
	speakableText: string,
	structured?: unknown,
): SkillCallResultType => ({
	text,
	status: "ok",
	isError: false,
	speakableText,
	...(structured !== undefined ? { structured } : {}),
})

export const errorResult = (
	text: string,
	speakableText: string,
): SkillCallResultType => ({
	text,
	status: "error",
	isError: true,
	speakableText,
})
