import {
	SKILL_TOOL_NAME_SEPARATOR,
	SKILL_PROTOCOL_ENUM,
	DEFAULT_FAST_PATH_DURATION_MAX_SECONDS,
	type FastPathBlockType,
	type FastPathSlotType,
	type SkillToolType,
} from "@/db"
import { hashCanonical, skillEngineLogger } from "@/utils"
import {
	genericInvocationTarget,
	type SkillConnectionType,
} from "@/modules/skill-engine"

import { fold } from "./normalize"
import { parseTemplate, lintTemplate, prefilterOf } from "./grammar"
import type {
	CompiledFastPathIndexType,
	CompiledIntentType,
	CompiledSlotType,
	FastPathSlotValueType,
} from "../types"

const schemaEnumValues = (
	tool: SkillToolType | undefined,
	arg: string,
): string[] => {
	const props = tool?.inputSchema.properties as
		| Record<string, unknown>
		| undefined
	const prop = props?.[arg] as { enum?: unknown } | undefined
	return Array.isArray(prop?.enum)
		? prop.enum.filter((v): v is string => typeof v === "string")
		: []
}

const compileSlot = (
	conn: SkillConnectionType,
	tool: SkillToolType | undefined,
	slotName: string,
	slot: FastPathSlotType,
	language: string | null,
	contextMemo: Map<string, CompiledSlotType | null>,
): CompiledSlotType | null => {
	const argName = slot.arg ?? slotName
	const slotValue = (
		phrase: string,
		args: Record<string, unknown>,
	): FastPathSlotValueType => ({
		phrase,
		folded: fold(phrase),
		args,
		target: genericInvocationTarget(args),
	})
	if (slot.source.kind === "range")
		return {
			kind: "range",
			min: slot.source.min,
			max: slot.source.max,
			arg: argName,
		}
	if (slot.source.kind === "duration")
		return {
			kind: "duration",
			maxSeconds:
				slot.source.maxSeconds ?? DEFAULT_FAST_PATH_DURATION_MAX_SECONDS,
			arg: argName,
		}
	if (slot.source.kind === "clockTime")
		return { kind: "clockTime", arg: argName }
	if (slot.source.kind === "enum")
		return valuesSlot(
			slot.source.values.map((v) => slotValue(v, { [argName]: v })),
		)
	if (slot.source.kind === "map")
		return valuesSlot(
			slot.source.values.flatMap((entry) =>
				entry.in.map((phrase) => slotValue(phrase, { [argName]: entry.out })),
			),
		)
	if (slot.source.kind === "schemaEnum") {
		const values = schemaEnumValues(tool, slot.source.arg)
		if (values.length === 0) return null
		return valuesSlot(values.map((v) => slotValue(v, { [argName]: v })))
	}
	const memoKey = `${conn.providerId}|${slot.source.key}|${argName}`
	const memo = contextMemo.get(memoKey)
	if (memo !== undefined) return memo
	const provided = conn.specialization?.fastPathSlotValues?.(
		conn.provider,
		slot.source.key,
		language,
	)
	const compiled =
		!provided || provided.length === 0
			? null
			: valuesSlot(
					provided
						.map((p) => slotValue(p.phrase, p.args))
						.filter((p) => p.folded.length > 0)
						.sort((a, b) => b.folded.length - a.folded.length),
				)
	contextMemo.set(memoKey, compiled)
	return compiled
}

const numberFormOf = (folded: string): string | null => {
	const tokens = folded.split(" ")
	const last = tokens[tokens.length - 1]
	if (!last || last.length < 4) return null
	const variant = last.endsWith("s") ? last.slice(0, -1) : `${last}s`
	return [...tokens.slice(0, -1), variant].join(" ")
}

const withNumberForms = (
	values: FastPathSlotValueType[],
): FastPathSlotValueType[] => {
	const seen = new Set(values.map((v) => v.folded))
	const out = [...values]
	for (const v of values) {
		const variant = numberFormOf(v.folded)
		if (!variant || seen.has(variant)) continue
		seen.add(variant)
		out.push({ ...v, folded: variant })
	}
	return out.sort((a, b) => b.folded.length - a.folded.length)
}

const valuesSlot = (
	values: FastPathSlotValueType[],
): CompiledSlotType | null => {
	const kept = dropAmbiguousPhrases(
		withNumberForms(values.filter((v) => v.folded.length > 0)),
	)
	return kept.length > 0 ? { kind: "values", values: kept } : null
}

const dropAmbiguousPhrases = (
	values: FastPathSlotValueType[],
): FastPathSlotValueType[] => {
	const argsByFolded = new Map<string, Set<string>>()
	for (const v of values) {
		const set = argsByFolded.get(v.folded) ?? new Set<string>()
		set.add(hashCanonical(v.args))
		argsByFolded.set(v.folded, set)
	}
	const ambiguous = new Set(
		[...argsByFolded.entries()]
			.filter(([, argSets]) => argSets.size > 1)
			.map(([folded]) => folded),
	)
	if (ambiguous.size > 0)
		skillEngineLogger.warn(
			"fast-path slot phrases dropped — same alias resolves to different targets",
			{ phrases: [...ambiguous].slice(0, 5) },
		)
	return values.filter((v) => !ambiguous.has(v.folded))
}

const fastPathBlockOf = (
	conn: SkillConnectionType,
): FastPathBlockType | null => {
	const descriptor = conn.provider.descriptor
	const server = conn.provider.serverDescriptor
	const locale = conn.language
		? descriptor?.i18n?.[conn.language]?.fastPath
		: undefined
	const serverLocale = conn.language
		? server?.i18n?.[conn.language]?.fastPath
		: undefined
	const generatedRoot = conn.specialization?.descriptorDefaults?.(
		conn.provider.toolsCache ?? [],
		conn.language,
		conn.provider,
	)
	const generatedLocale = conn.language
		? generatedRoot?.i18n?.[conn.language]?.fastPath
		: undefined
	return (
		locale ??
		descriptor?.fastPath ??
		serverLocale ??
		server?.fastPath ??
		generatedLocale ??
		generatedRoot?.fastPath ??
		null
	)
}

export const dynamicHashOf = (
	connections: SkillConnectionType[],
	language: string | null,
): string => {
	const parts: unknown[] = []
	for (const conn of connections) {
		const block = fastPathBlockOf(conn)
		if (!block) continue
		parts.push([
			conn.providerId,
			conn.provider.updatedAt,
			conn.provider.lastSyncAt,
			conn.provider.serverDescriptorHash,
			[...conn.allowedTools].sort(),
		])
		const keys = new Set<string>()
		for (const intent of block.intents)
			for (const slot of Object.values(intent.slots ?? {}))
				if (slot.source.kind === "context") keys.add(slot.source.key)
		for (const key of [...keys].sort())
			parts.push([
				conn.providerId,
				key,
				(
					conn.specialization?.fastPathSlotValues?.(
						conn.provider,
						key,
						language,
					) ?? []
				).map((v) => [v.phrase, v.args]),
			])
	}
	return hashCanonical(parts)
}

export const compileIndex = (
	connections: SkillConnectionType[],
	language: string | null,
): CompiledFastPathIndexType => {
	const intents: CompiledIntentType[] = []
	const contextMemo = new Map<string, CompiledSlotType | null>()
	for (const conn of connections) {
		const block = fastPathBlockOf(conn)
		if (!block) continue
		const rules = block.expansionRules ?? {}
		const availability = conn.specialization?.toolAvailability
		const builtin = conn.provider.protocol === SKILL_PROTOCOL_ENUM.BUILTIN
		for (const intent of block.intents) {
			if (!conn.allowedTools.has(intent.tool)) continue
			const namespacedName = `${conn.providerSlug}${SKILL_TOOL_NAME_SEPARATOR}${intent.tool}`
			const tool = (conn.provider.toolsCache ?? []).find(
				(t) => t.rawName === intent.tool,
			)
			const slots = new Map<string, CompiledSlotType>()
			let slotsReady = true
			for (const [slotName, slot] of Object.entries(intent.slots ?? {})) {
				const compiled = compileSlot(
					conn,
					tool,
					slotName,
					slot,
					language,
					contextMemo,
				)
				if (!compiled) {
					slotsReady = false
					break
				}
				slots.set(slotName, compiled)
			}
			if (!slotsReady) continue
			const templates: CompiledIntentType["templates"] = []
			for (const src of intent.templates) {
				try {
					const ast = parseTemplate(src, rules)
					lintTemplate(ast, src)
					templates.push({
						ast,
						prefilter: new RegExp(prefilterOf(ast).pattern, "i"),
						source: src,
					})
				} catch (error) {
					skillEngineLogger.warn("fast-path template rejected", {
						template: src,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}
			if (templates.length === 0) continue
			intents.push({
				tool: intent.tool,
				namespacedName,
				providerSlug: conn.providerSlug,
				templates,
				slots,
				requiredKeywords: (intent.requiredKeywords ?? []).map((group) =>
					group.map((k) => fold(k)),
				),
				argDefaults: intent.argDefaults ?? {},
				priority: intent.priority ?? 0,
				allowBlockedTokens: intent.allowBlockedTokens ?? false,
				builtin,
				available: availability
					? (origin) => availability(conn.provider, intent.tool, origin)
					: null,
			})
		}
	}
	return {
		intents,
		dynamicHash: dynamicHashOf(connections, language),
		builtAt: Date.now(),
	}
}
