import {
	SKILL_SERVER_DESCRIPTOR_MAX_BYTES,
	SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATES,
	SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATE_CHARS,
	SKILL_SERVER_DESCRIPTOR_MAX_EXPANSION_RULES,
	SKILL_SERVER_DESCRIPTOR_MAX_EXPANSION_DEPTH,
	SKILL_SERVER_DESCRIPTOR_MAX_SLOT_VALUES,
	SKILL_SERVER_DESCRIPTOR_MAX_FINALIZE_CHARS,
	SKILL_SERVER_DESCRIPTOR_MAX_DESCRIPTION_CHARS,
	type DomiaSkillDescriptorType,
	type FastPathBlockType,
	type FastPathIntentType,
	type FastPathSlotType,
	type SkillDescriptorLocaleType,
	type SkillDescriptorRoutingType,
	type SkillToolType,
	type ToolFinalizeMapType,
	type ToolFinalizeRuleType,
} from "@/db"
import {
	hashCanonical,
	sanitizeUntrustedText,
	skillEngineLogger,
} from "@/utils"

import { domiaSkillDescriptorSchema } from "../schemas"
import type {
	IngestedServerDescriptorType,
	ServerDescriptorIngestContextType,
} from "../types"
import { toolBaseName } from "./tool-name"

const RULE_REF = /<([^<>]+)>/g
const PLACEHOLDER = /\{(\w+)\}/g
const RENDERER_PLACEHOLDERS = new Set(["speakable", "name"])
const BENIGN_SANITIZE_REASONS = new Set(["control-chars", "newlines", "length"])
const FINALIZE_TEXT_KEYS = ["ack", "error", "done"] as const

const warnRejected = (
	ctx: ServerDescriptorIngestContextType,
	reason: string,
	meta: Record<string, unknown> = {},
): void =>
	skillEngineLogger.warn("server descriptor rejected", {
		provider: ctx.provider,
		reason,
		...meta,
	})

const byteSizeOf = (raw: unknown): number =>
	raw === undefined ? 0 : Buffer.byteLength(JSON.stringify(raw), "utf8")

const cleanText = (text: string, maxLength: number): string | null => {
	const result = sanitizeUntrustedText(text, {
		maxLength,
		collapseNewlines: true,
	})
	const injected = result.reasons.some((r) => !BENIGN_SANITIZE_REASONS.has(r))
	return injected || result.text.length === 0 ? null : result.text
}

const cleanTextList = (
	list: string[] | undefined,
	maxLength: number,
): string[] | undefined => {
	if (!list) return undefined
	const kept = list
		.map((item) => cleanText(item, maxLength))
		.filter((item): item is string => item !== null)
	return kept.length > 0 ? kept : undefined
}

const cleanRouting = (
	routing: SkillDescriptorRoutingType | undefined,
): SkillDescriptorRoutingType | undefined => {
	if (!routing) return undefined
	const aliases = routing.aliases
		? Object.fromEntries(
				Object.entries(routing.aliases)
					.map(([tool, list]) => [
						tool,
						cleanTextList(list, SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATE_CHARS),
					])
					.filter(
						(entry): entry is [string, string[]] => entry[1] !== undefined,
					),
			)
		: undefined
	const exampleUtterances = cleanTextList(
		routing.exampleUtterances,
		SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATE_CHARS,
	)
	const keywords = cleanTextList(
		routing.keywords,
		SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATE_CHARS,
	)
	const out: SkillDescriptorRoutingType = {
		...(aliases && Object.keys(aliases).length > 0 ? { aliases } : {}),
		...(exampleUtterances ? { exampleUtterances } : {}),
		...(keywords ? { keywords } : {}),
	}
	return Object.keys(out).length > 0 ? out : undefined
}

const placeholdersRenderable = (
	text: string,
	knownArgs: Set<string> | null,
): boolean => {
	const leftover = text.replace(PLACEHOLDER, (_, key: string) =>
		knownArgs === null || RENDERER_PLACEHOLDERS.has(key) || knownArgs.has(key)
			? ""
			: "{",
	)
	return !leftover.includes("{") && !leftover.includes("}")
}

const knownArgsOf = (
	tools: SkillToolType[] | undefined,
	toolKey: string,
): Set<string> | null => {
	if (!tools || toolKey === "*") return null
	const tool = tools.find(
		(t) => t.rawName === toolKey || toolBaseName(t.rawName) === toolKey,
	)
	if (!tool) return null
	const props = tool.inputSchema.properties
	return new Set(props && typeof props === "object" ? Object.keys(props) : [])
}

const cleanFinalizeRule = (
	rule: ToolFinalizeRuleType,
	knownArgs: Set<string> | null,
): ToolFinalizeRuleType | null => {
	const out: ToolFinalizeRuleType = {
		mode: rule.mode,
		...(rule.ackAfterMs !== undefined ? { ackAfterMs: rule.ackAfterMs } : {}),
	}
	for (const key of FINALIZE_TEXT_KEYS) {
		const text = rule[key]
		if (text === undefined) continue
		const cleaned = cleanText(text, SKILL_SERVER_DESCRIPTOR_MAX_FINALIZE_CHARS)
		if (cleaned === null || !placeholdersRenderable(cleaned, knownArgs))
			return null
		out[key] = cleaned
	}
	return out
}

const cleanFinalize = (
	map: ToolFinalizeMapType | undefined,
	ctx: ServerDescriptorIngestContextType,
): ToolFinalizeMapType | undefined => {
	if (!map) return undefined
	const out: ToolFinalizeMapType = {}
	for (const [tool, rule] of Object.entries(map)) {
		if (!rule) continue
		const cleaned = cleanFinalizeRule(rule, knownArgsOf(ctx.knownTools, tool))
		if (cleaned) out[tool] = cleaned
		else
			skillEngineLogger.warn("server descriptor finalize rule dropped", {
				provider: ctx.provider,
				tool,
			})
	}
	return Object.keys(out).length > 0 ? out : undefined
}

const expansionDepthOf = (
	rules: Record<string, string>,
	name: string,
	stack: Set<string>,
): number => {
	if (stack.has(name)) return Number.POSITIVE_INFINITY
	if (!Object.hasOwn(rules, name)) return 0
	const body = rules[name]
	stack.add(name)
	const nested = [...body.matchAll(RULE_REF)].reduce(
		(max, match) =>
			Math.max(max, expansionDepthOf(rules, match[1].trim(), stack)),
		0,
	)
	stack.delete(name)
	return 1 + nested
}

const slotViolation = (slot: FastPathSlotType): string | null => {
	const source = slot.source
	if (source.kind === "context") return "context slot"
	if (
		source.kind === "enum" &&
		source.values.length > SKILL_SERVER_DESCRIPTOR_MAX_SLOT_VALUES
	)
		return "too many enum values"
	if (
		source.kind === "map" &&
		source.values.reduce((n, v) => n + v.in.length, 0) >
			SKILL_SERVER_DESCRIPTOR_MAX_SLOT_VALUES
	)
		return "too many map values"
	return null
}

const cleanIntent = (intent: FastPathIntentType): FastPathIntentType => ({
	tool: intent.tool,
	templates: intent.templates,
	...(intent.slots ? { slots: intent.slots } : {}),
	...(intent.requiredKeywords
		? { requiredKeywords: intent.requiredKeywords }
		: {}),
	...(intent.argDefaults ? { argDefaults: intent.argDefaults } : {}),
	...(intent.priority !== undefined ? { priority: intent.priority } : {}),
})

const cleanFastPath = (
	block: FastPathBlockType | undefined,
	counter: { templates: number },
): FastPathBlockType | string | undefined => {
	if (!block) return undefined
	const rules = block.expansionRules ?? {}
	if (Object.keys(rules).length > SKILL_SERVER_DESCRIPTOR_MAX_EXPANSION_RULES)
		return "too many expansion rules"
	const tooDeep = Object.keys(rules).find(
		(name) =>
			expansionDepthOf(rules, name, new Set()) >
			SKILL_SERVER_DESCRIPTOR_MAX_EXPANSION_DEPTH,
	)
	if (tooDeep !== undefined)
		return `expansion rule <${tooDeep}> too deep or recursive`
	for (const intent of block.intents) {
		counter.templates += intent.templates.length
		if (counter.templates > SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATES)
			return "too many templates"
		const long = intent.templates.find(
			(t) => t.length > SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATE_CHARS,
		)
		if (long !== undefined) return `template too long: ${long.slice(0, 40)}`
		for (const [name, slot] of Object.entries(intent.slots ?? {})) {
			const violation = slotViolation(slot)
			if (violation) return `${violation} ({${name}} of ${intent.tool})`
		}
	}
	return {
		intents: block.intents.map(cleanIntent),
		...(block.expansionRules ? { expansionRules: block.expansionRules } : {}),
	}
}

const cleanLocale = (
	locale: SkillDescriptorLocaleType,
	ctx: ServerDescriptorIngestContextType,
	counter: { templates: number },
): SkillDescriptorLocaleType | string => {
	const fastPath = cleanFastPath(locale.fastPath, counter)
	if (typeof fastPath === "string") return fastPath
	const finalize = cleanFinalize(locale.finalize, ctx)
	const genericWords = cleanTextList(
		locale.genericWords,
		SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATE_CHARS,
	)
	return {
		...cleanRouting(locale),
		...(finalize ? { finalize } : {}),
		...(genericWords ? { genericWords } : {}),
		...(fastPath ? { fastPath } : {}),
	}
}

export const ingestServerDescriptor = (
	raw: unknown,
	ctx: ServerDescriptorIngestContextType,
): IngestedServerDescriptorType | null => {
	const bytes = byteSizeOf(raw)
	if (bytes > SKILL_SERVER_DESCRIPTOR_MAX_BYTES) {
		warnRejected(ctx, "oversize", {
			bytes,
			max: SKILL_SERVER_DESCRIPTOR_MAX_BYTES,
		})
		return null
	}
	const parsed = domiaSkillDescriptorSchema.safeParse(raw)
	if (!parsed.success) {
		warnRejected(ctx, "schema", {
			issues: parsed.error.issues.slice(0, 5).map((i) => i.message),
		})
		return null
	}
	const source = parsed.data
	const counter = { templates: 0 }
	const fastPath = cleanFastPath(source.fastPath, counter)
	if (typeof fastPath === "string") {
		warnRejected(ctx, fastPath)
		return null
	}
	const i18n: Record<string, SkillDescriptorLocaleType> = {}
	for (const [lang, locale] of Object.entries(source.i18n ?? {})) {
		const cleaned = cleanLocale(locale, ctx, counter)
		if (typeof cleaned === "string") {
			warnRejected(ctx, cleaned, { lang })
			return null
		}
		if (Object.keys(cleaned).length > 0) i18n[lang] = cleaned
	}
	const description =
		source.description === undefined
			? null
			: cleanText(
					source.description,
					SKILL_SERVER_DESCRIPTOR_MAX_DESCRIPTION_CHARS,
				)
	const routing = cleanRouting(source.routing)
	const finalize = cleanFinalize(source.execution?.finalize, ctx)
	const genericWords = cleanTextList(
		source.execution?.genericWords,
		SKILL_SERVER_DESCRIPTOR_MAX_TEMPLATE_CHARS,
	)
	const execution = {
		...(finalize ? { finalize } : {}),
		...(genericWords ? { genericWords } : {}),
	}
	const descriptor: DomiaSkillDescriptorType = {
		version: 1,
		...(description ? { description } : {}),
		...(routing ? { routing } : {}),
		...(Object.keys(execution).length > 0 ? { execution } : {}),
		...(fastPath ? { fastPath } : {}),
		...(Object.keys(i18n).length > 0 ? { i18n } : {}),
	}
	return { descriptor, hash: hashCanonical(descriptor) }
}

export const ingestServerDescriptorText = (
	text: string,
	ctx: ServerDescriptorIngestContextType,
): IngestedServerDescriptorType | null => {
	const bytes = Buffer.byteLength(text, "utf8")
	if (bytes > SKILL_SERVER_DESCRIPTOR_MAX_BYTES) {
		warnRejected(ctx, "oversize", {
			bytes,
			max: SKILL_SERVER_DESCRIPTOR_MAX_BYTES,
		})
		return null
	}
	try {
		return ingestServerDescriptor(JSON.parse(text), ctx)
	} catch (error) {
		warnRejected(ctx, "corrupt json", {
			message: error instanceof Error ? error.message : String(error),
		})
		return null
	}
}
