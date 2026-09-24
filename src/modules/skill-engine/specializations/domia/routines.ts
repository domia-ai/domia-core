import { z, type ZodType } from "zod"
import {
	ROUTINE_MAX_STEPS,
	ROUTINE_SLUG_PATTERN,
	ROUTINE_TOOL_PREFIX,
	SKILL_PROTOCOL_ENUM,
	SKILL_TOOL_NAME_SEPARATOR,
	type FastPathIntentType,
	type FastPathSlotType,
	type RoutineStepType,
	type SelectRoutineType,
	type ToolFinalizeRuleType,
	type ToolHintOverrideType,
	type ToolPolicyType,
} from "@/db"
import {
	SUPPORTED_LANGUAGES,
	SKILL_ERRORS,
	domiaError,
	generateUuid,
	languageSetsFor,
	skillEngineLogger,
} from "@/utils"
import { lintTemplate, parseTemplate } from "@/modules/fast-path/utils/grammar"
import type { FastPathAstNodeType } from "@/modules/fast-path/types"

import dbAdapter from "../../db-adapter"
import {
	getConnectionsFor,
	getInvocationPolicy,
	toolAvailableFor,
} from "../../controller/registry"
import {
	argsSchemaIssue,
	placeholdersIn,
	WHOLE_PLACEHOLDER_RE,
} from "../../utils/args-schema"
import { SPEAKABLE_PLACEHOLDER } from "../../utils/finalize-render"
import type {
	OriginCapabilitiesType,
	RawSkillToolType,
	SkillConnectionType,
} from "../../types"

import {
	DOMIA_PACK_BASE_LANGUAGE,
	DOMIA_ROUTINE_MIN_TIMEOUT_MS,
	DOMIA_ROUTINE_REPLY_PLACEHOLDER_ARG,
	DOMIA_ROUTINE_UNSUPPORTED_SLOT_KINDS,
	DOMIA_WRITE_HINTS,
	DOMIA_CLOCK_RE,
} from "./constants"
import { baseLanguageOf, fillPlaceholders } from "./packs"
import type {
	RoutineInputType,
	RoutineSaveResultType,
	RoutineStepTargetType,
} from "./types"

const POLICY_RANK: Record<ToolPolicyType, number> = {
	allow: 0,
	confirm: 1,
	block: 2,
}
const memo = new Map<string, SelectRoutineType[]>()

export const routinesOf = (domiaId: string): SelectRoutineType[] => {
	const hit = memo.get(domiaId)
	if (hit) return hit
	try {
		const rows = dbAdapter.listRoutines(domiaId)
		memo.set(domiaId, rows)
		return rows
	} catch (error) {
		skillEngineLogger.warn("routine list failed — none advertised", {
			domiaId,
			error,
		})
		return []
	}
}

export const activeRoutinesOf = (domiaId: string): SelectRoutineType[] =>
	routinesOf(domiaId).filter((r) => r.isActive)

export const invalidateRoutines = (domiaId: string): void => {
	memo.delete(domiaId)
}

export const routineToolName = (slug: string): string =>
	`${ROUTINE_TOOL_PREFIX}${slug}`

const isRoutineTool = (rawName: string): boolean =>
	rawName.startsWith(ROUTINE_TOOL_PREFIX)

export const routineForTool = (
	domiaId: string,
	rawName: string,
): SelectRoutineType | null =>
	isRoutineTool(rawName)
		? (activeRoutinesOf(domiaId).find(
				(r) => routineToolName(r.slug) === rawName,
			) ?? null)
		: null

const stepTarget = (namespacedName: string): RoutineStepTargetType => {
	const idx = namespacedName.indexOf(SKILL_TOOL_NAME_SEPARATOR)
	return {
		providerSlug: idx >= 0 ? namespacedName.slice(0, idx) : "",
		rawName:
			idx >= 0
				? namespacedName.slice(idx + SKILL_TOOL_NAME_SEPARATOR.length)
				: namespacedName,
	}
}

const stepConnection = (
	domiaId: string,
	namespacedName: string,
): SkillConnectionType | null => {
	const { providerSlug, rawName } = stepTarget(namespacedName)
	return (
		getConnectionsFor(domiaId).find(
			(c) => c.providerSlug === providerSlug && c.allowedTools.has(rawName),
		) ?? null
	)
}

export const routineStepPolicy = (
	domiaId: string,
	namespacedName: string,
	args: Record<string, unknown>,
): ToolPolicyType =>
	stepConnection(domiaId, namespacedName)
		? getInvocationPolicy(domiaId, namespacedName, args).policy
		: "block"

const strictestOf = (a: ToolPolicyType, b: ToolPolicyType): ToolPolicyType =>
	POLICY_RANK[b] > POLICY_RANK[a] ? b : a

const isScalar = (value: unknown): value is string | number | boolean =>
	typeof value === "string" ||
	typeof value === "number" ||
	typeof value === "boolean"

const slotArgName = (name: string, slot: FastPathSlotType): string =>
	slot.arg ?? name

const slotCandidates = (slot: FastPathSlotType): unknown[] | null => {
	switch (slot.source.kind) {
		case "enum":
			return slot.source.values
		case "map": {
			const outs = slot.source.values.map((v) => v.out)
			return outs.every(isScalar) ? outs : null
		}
		case "range":
		case "duration":
		case "clockTime":
			return []
		default:
			return null
	}
}

const stepEscalatesByEntity = (
	domiaId: string,
	namespacedName: string,
): boolean => {
	const conn = stepConnection(domiaId, namespacedName)
	if (!conn?.specialization?.invocationRisk) return false
	const { rawName } = stepTarget(namespacedName)
	return conn.toolMeta.get(rawName)?.policySource === "risk_default"
}

const stepPolicyOverSlots = (
	domiaId: string,
	step: RoutineStepType,
	slots: Record<string, FastPathSlotType>,
): ToolPolicyType => {
	const literal = routineStepPolicy(domiaId, step.tool, step.args)
	const referenced = new Set(placeholdersIn(step.args))
	if (referenced.size === 0 || !stepEscalatesByEntity(domiaId, step.tool))
		return literal
	return Object.entries(slots)
		.filter(([name, slot]) => referenced.has(slotArgName(name, slot)))
		.reduce<ToolPolicyType>((strictest, [name, slot]) => {
			const candidates = slotCandidates(slot)
			if (!candidates) return strictestOf(strictest, "confirm")
			const argName = slotArgName(name, slot)
			return candidates.reduce<ToolPolicyType>(
				(acc, value) =>
					strictestOf(
						acc,
						routineStepPolicy(
							domiaId,
							step.tool,
							substituteStepArgs(step.args, { [argName]: value }),
						),
					),
				strictest,
			)
		}, literal)
}

export const routinePolicyOf = (
	domiaId: string,
	routine: SelectRoutineType,
): ToolPolicyType =>
	routine.steps.reduce<ToolPolicyType>(
		(strictest, step) =>
			strictestOf(
				strictest,
				stepPolicyOverSlots(domiaId, step, routine.slots ?? {}),
			),
		"allow",
	)

export const routineGatedByConfirmation = (
	domiaId: string,
	routine: SelectRoutineType,
): boolean =>
	getConnectionsFor(domiaId).some(
		(c) =>
			c.provider.protocol === SKILL_PROTOCOL_ENUM.BUILTIN &&
			c.toolMeta.get(routineToolName(routine.slug))?.policy === "confirm",
	)

const stepTimeoutMs = (domiaId: string, namespacedName: string): number => {
	const conn = stepConnection(domiaId, namespacedName)
	if (!conn) return 0
	const { rawName } = stepTarget(namespacedName)
	return conn.toolMeta.get(rawName)?.timeoutMs ?? conn.timeoutMs
}

const routineStepsTimeoutMs = (
	domiaId: string,
	routine: SelectRoutineType,
): number =>
	routine.steps.reduce(
		(sum, step) => sum + stepTimeoutMs(domiaId, step.tool),
		0,
	)

export const routineTimeoutMs = (
	domiaId: string,
	routine: SelectRoutineType,
	budgetMs: number,
): number =>
	Math.max(
		DOMIA_ROUTINE_MIN_TIMEOUT_MS,
		Math.min(routineStepsTimeoutMs(domiaId, routine), budgetMs),
	)

export const routineAvailableFor = (
	domiaId: string,
	routine: SelectRoutineType,
	origin: OriginCapabilitiesType,
): boolean =>
	routine.steps.every((step) => toolAvailableFor(domiaId, step.tool, origin))

const slotJsonType = (slot: FastPathSlotType): string =>
	slot.source.kind === "range" || slot.source.kind === "duration"
		? "number"
		: "string"

const slotArgNames = (
	slots: Record<string, FastPathSlotType> | null | undefined,
): Set<string> =>
	new Set(
		Object.entries(slots ?? {}).map(([name, slot]) => slotArgName(name, slot)),
	)

export const routineToolDefinition = (
	routine: SelectRoutineType,
): RawSkillToolType => ({
	name: routineToolName(routine.slug),
	description: routine.description,
	inputSchema: {
		type: "object",
		properties: Object.fromEntries(
			Object.entries(routine.slots ?? {}).map(([name, slot]) => [
				slotArgName(name, slot),
				{ type: slotJsonType(slot) },
			]),
		),
		required: [...slotArgNames(routine.slots)],
	},
	annotations: DOMIA_WRITE_HINTS,
})

const slotArgSchema = (slot: FastPathSlotType): ZodType =>
	slot.source.kind === "range" || slot.source.kind === "duration"
		? z.number()
		: slot.source.kind === "clockTime"
			? z.string().regex(DOMIA_CLOCK_RE)
			: z.string().min(1)

export const routineArgsSchema = (
	routine: SelectRoutineType,
): ZodType<Record<string, unknown>> =>
	z
		.object(
			Object.fromEntries(
				Object.entries(routine.slots ?? {}).map(([name, slot]) => [
					slotArgName(name, slot),
					slotArgSchema(slot),
				]),
			),
		)
		.strict()

const forLanguage = <T>(
	byLanguage: Record<string, T>,
	language: string | null,
): T | undefined =>
	byLanguage[baseLanguageOf(language)] ?? byLanguage[DOMIA_PACK_BASE_LANGUAGE]

export const routineIntentOf = (
	routine: SelectRoutineType,
	language: string | null,
): FastPathIntentType | null => {
	const templates = forLanguage(routine.phrases, language)
	if (!templates || templates.length === 0) return null
	return {
		tool: routineToolName(routine.slug),
		templates,
		...(routine.slots ? { slots: routine.slots } : {}),
		priority: 0,
	}
}

const routineReplyOf = (
	routine: SelectRoutineType,
	language: string | null,
): string => forLanguage(routine.reply, language) ?? ""

export const routineFinalizeOf = (
	routine: SelectRoutineType,
	language: string | null,
): ToolFinalizeRuleType => {
	const reply = routineReplyOf(routine, language)
	return {
		mode: "template",
		ack: SPEAKABLE_PLACEHOLDER,
		done: reply.includes(SPEAKABLE_PLACEHOLDER) ? SPEAKABLE_PLACEHOLDER : reply,
		error: SPEAKABLE_PLACEHOLDER,
	}
}

export const routineHintOf = (
	domiaId: string,
	routine: SelectRoutineType,
): ToolHintOverrideType => ({
	...DOMIA_WRITE_HINTS,
	timeoutMs: Math.max(
		DOMIA_ROUTINE_MIN_TIMEOUT_MS,
		routineStepsTimeoutMs(domiaId, routine),
	),
})

const substituteValue = (
	value: unknown,
	args: Record<string, unknown>,
): unknown => {
	if (typeof value === "string") {
		const whole = WHOLE_PLACEHOLDER_RE.exec(value)
		if (whole) return isScalar(args[whole[1]]) ? args[whole[1]] : value
		return fillPlaceholders(value, args)
	}
	if (Array.isArray(value)) return value.map((v) => substituteValue(v, args))
	if (value !== null && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, substituteValue(v, args)]),
		)
	return value
}

export const substituteStepArgs = (
	stepArgs: Record<string, unknown>,
	args: Record<string, unknown>,
): Record<string, unknown> =>
	substituteValue(stepArgs, args) as Record<string, unknown>

export const renderRoutineReply = (
	routine: SelectRoutineType,
	language: string | null,
	args: Record<string, unknown>,
	speakable: string,
): string => {
	const rendered = fillPlaceholders(routineReplyOf(routine, language), args)
		.split(SPEAKABLE_PLACEHOLDER)
		.join(speakable)
		.trim()
	return rendered || languageSetsFor(language).phrases.thatIsDone
}

const slotNamesIn = (nodes: FastPathAstNodeType[]): string[] =>
	nodes.flatMap((node) => {
		if (node.kind === "slot") return [node.name]
		if (node.kind === "optional") return slotNamesIn(node.body)
		if (node.kind === "group") return node.alternatives.flatMap(slotNamesIn)
		return []
	})

const templateIssue = (
	template: string,
	slotNames: Set<string>,
): string | null => {
	try {
		const ast = parseTemplate(template, {})
		lintTemplate(ast, template)
		const unknown = slotNamesIn(ast).find((name) => !slotNames.has(name))
		return unknown ? `unknown slot {${unknown}} in "${template}"` : null
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
}

const languageIssue = (
	label: string,
	byLanguage: Record<string, unknown>,
): string | null => {
	const languages = Object.keys(byLanguage)
	if (!languages.includes(DOMIA_PACK_BASE_LANGUAGE))
		return `${label} must include "${DOMIA_PACK_BASE_LANGUAGE}"`
	const unknown = languages.find((code) => !SUPPORTED_LANGUAGES.has(code))
	return unknown ? `${label} has an unknown language "${unknown}"` : null
}

const stepIssue = (
	domiaId: string,
	step: RoutineStepType,
	argNames: Set<string>,
): string | null => {
	const { rawName } = stepTarget(step.tool)
	const conn = stepConnection(domiaId, step.tool)
	if (!conn) return `step tool "${step.tool}" is not available on this identity`
	if (
		conn.provider.protocol === SKILL_PROTOCOL_ENUM.BUILTIN &&
		isRoutineTool(rawName)
	)
		return `step tool "${step.tool}" is a routine — routines may not call routines`
	const schema = (conn.provider.toolsCache ?? []).find(
		(t) => t.rawName === rawName,
	)?.inputSchema
	const issue = argsSchemaIssue(step.args, schema ?? {}, argNames)
	return issue ? `step "${step.tool}": ${issue}` : null
}

const validationIssue = (
	domiaId: string,
	input: RoutineInputType,
): string | null => {
	if (!ROUTINE_SLUG_PATTERN.test(input.slug))
		return `slug must match ${ROUTINE_SLUG_PATTERN.source}`
	if (input.steps.length === 0) return "a routine needs at least one step"
	if (input.steps.length > ROUTINE_MAX_STEPS)
		return `a routine may have at most ${ROUTINE_MAX_STEPS} steps`
	const slots = input.slots ?? {}
	for (const [name, slot] of Object.entries(slots)) {
		if (DOMIA_ROUTINE_UNSUPPORTED_SLOT_KINDS.has(slot.source.kind))
			return `slot {${name}} may not use a "${slot.source.kind}" source`
		if (slotArgName(name, slot) === DOMIA_ROUTINE_REPLY_PLACEHOLDER_ARG)
			return `slot {${name}} may not fill the reserved argument "${DOMIA_ROUTINE_REPLY_PLACEHOLDER_ARG}"`
	}
	const argNames = slotArgNames(slots)
	for (const step of input.steps) {
		const issue = stepIssue(domiaId, step, argNames)
		if (issue) return issue
	}
	const phrasesIssue = languageIssue("phrases", input.phrases)
	if (phrasesIssue) return phrasesIssue
	const slotNames = new Set(Object.keys(slots))
	for (const [language, templates] of Object.entries(input.phrases)) {
		if (templates.length === 0) return `phrases.${language} is empty`
		for (const template of templates) {
			const issue = templateIssue(template, slotNames)
			if (issue) return `phrases.${language}: ${issue}`
		}
	}
	const replyIssue = languageIssue("reply", input.reply)
	if (replyIssue) return replyIssue
	for (const [language, reply] of Object.entries(input.reply)) {
		if (!reply.trim()) return `reply.${language} is empty`
		const unknown = placeholdersIn(reply).find(
			(name) =>
				name !== DOMIA_ROUTINE_REPLY_PLACEHOLDER_ARG && !argNames.has(name),
		)
		if (unknown) return `reply.${language}: unknown placeholder {${unknown}}`
	}
	return null
}

const validateRoutine = (domiaId: string, input: RoutineInputType): void => {
	const issue = validationIssue(domiaId, input)
	if (issue)
		throw domiaError(SKILL_ERRORS.ROUTINE_INVALID, {
			logger: skillEngineLogger,
			messageOverride: issue,
			meta: { domiaId, slug: input.slug },
		})
}

export const saveRoutine = (
	domiaId: string,
	input: RoutineInputType,
): RoutineSaveResultType => {
	validateRoutine(domiaId, input)
	const existing = input.id
		? dbAdapter.getRoutine(domiaId, input.id)
		: dbAdapter.getRoutineBySlug(domiaId, input.slug)
	const fields = {
		slug: input.slug,
		name: input.name,
		description: input.description,
		isActive: input.isActive ?? true,
		phrases: input.phrases,
		slots: input.slots ?? null,
		steps: input.steps,
		reply: input.reply,
	}
	const saved = existing
		? dbAdapter.updateRoutine(domiaId, existing.id, fields)
		: dbAdapter.insertRoutine({ id: generateUuid(), domiaId, ...fields })
	invalidateRoutines(domiaId)
	skillEngineLogger.info(
		`🧩 routine ${existing ? "updated" : "created"} "${saved.slug}"`,
		{ domiaId, steps: saved.steps.length },
	)
	return { routine: saved, created: !existing }
}

export const removeRoutine = (domiaId: string, id: string): boolean => {
	const removed = dbAdapter.deleteRoutine(domiaId, id)
	if (removed) {
		invalidateRoutines(domiaId)
		skillEngineLogger.info("🧩 routine deleted", { domiaId, id })
	}
	return removed
}
