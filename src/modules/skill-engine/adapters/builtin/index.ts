import {
	DEFAULT_AGENT_BUDGET_MS,
	MCP_TRANSPORT_ENUM_VALUES,
	SKILL_PROTOCOL_ENUM,
	type SelectRoutineType,
} from "@/db"
import { getTraceContext, languageSetsFor, skillEngineLogger } from "@/utils"
import type { DomiaType } from "@/modules/core"

import { runtimePort } from "../../controller/hooks"
import {
	renderRoutineReply,
	routineForTool,
	routinePolicyOf,
	routineTimeoutMs,
	routineToolDefinition,
	activeRoutinesOf,
	substituteStepArgs,
	routineArgsSchema,
	routineStepPolicy,
	routineGatedByConfirmation,
} from "../../specializations/domia/routines"
import { DOMIA_TOOLS } from "../../specializations/domia/tools"
import type {
	BuiltinToolType,
	SkillAdapterType,
	SkillCallResultType,
	SkillConnHandleType,
	SkillConnHooksType,
} from "../../types"

const BUILTIN_SOURCE = "tool"

const failure = (text: string, speakableText: string): SkillCallResultType => ({
	text,
	status: "error",
	isError: true,
	speakableText,
})

const toolByName = (rawName: string): BuiltinToolType | undefined =>
	DOMIA_TOOLS.find((tool) => tool.name === rawName)

const runRoutine = async (
	domia: DomiaType,
	routine: SelectRoutineType,
	args: Record<string, unknown>,
	hooks: SkillConnHooksType | undefined,
	signal?: AbortSignal,
): Promise<SkillCallResultType> => {
	const language = domia.characterProfile?.language ?? null
	const phrases = languageSetsFor(language).phrases
	const policy = routinePolicyOf(domia.id, routine)
	if (policy === "block") {
		skillEngineLogger.warn("routine refused — a step is blocked or offline", {
			routine: routine.slug,
			domiaId: domia.id,
		})
		return failure(
			`Routine "${routine.slug}" cannot run: a step is blocked or its provider is offline.`,
			phrases.cantDoThat,
		)
	}
	const invoke = hooks?.invokeTool
	if (!invoke)
		return failure(
			`Routine "${routine.slug}" cannot run: no tool invoker on this connection.`,
			phrases.cantDoThat,
		)
	const parsedArgs = routineArgsSchema(routine).safeParse(args)
	if (!parsedArgs.success)
		return failure(
			`Routine "${routine.slug}" rejected its arguments: ${parsedArgs.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
			phrases.cantDoThat,
		)
	const budgetMs =
		domia.llmModelConfig?.agentBudgetMs ?? DEFAULT_AGENT_BUDGET_MS
	const deadline = AbortSignal.timeout(
		routineTimeoutMs(domia.id, routine, budgetMs),
	)
	const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
	const confirmed = routineGatedByConfirmation(domia.id, routine)
	const texts: string[] = []
	const speakables: string[] = []
	for (const [index, step] of routine.steps.entries()) {
		if (combined.aborted)
			return failure(
				[...texts, `${step.tool}: not run (routine timed out)`].join("\n"),
				phrases.cantDoThat,
			)
		const stepArgs = substituteStepArgs(step.args, args)
		const stepPolicy = routineStepPolicy(domia.id, step.tool, stepArgs)
		if (stepPolicy === "block")
			return failure(
				[...texts, `${step.tool}: not run (blocked for these arguments)`].join(
					"\n",
				),
				phrases.cantDoThat,
			)
		if (stepPolicy === "confirm" && !confirmed) {
			skillEngineLogger.warn(
				"routine step requires confirmation for these arguments — not run",
				{ routine: routine.slug, step: step.tool, domiaId: domia.id },
			)
			return {
				text: `Routine "${routine.slug}" needs the user's confirmation and was not run.`,
				status: "blocked",
				isError: true,
				speakableText: phrases.cantDoThat,
			}
		}
		const res = await invoke(step.tool, stepArgs, combined, {
			routineSlug: routine.slug,
			stepIndex: index,
		})
		texts.push(`${step.tool}: ${res.text}`)
		if (res.isError) {
			skillEngineLogger.warn("routine stopped at a failing step", {
				routine: routine.slug,
				step: step.tool,
				status: res.status,
			})
			return {
				text: texts.join("\n"),
				status: res.status === "ok" ? "error" : res.status,
				isError: true,
				speakableText: res.speakableText ?? phrases.cantDoThat,
			}
		}
		if (res.speakableText) speakables.push(res.speakableText)
	}
	return {
		text: texts.join("\n"),
		status: "ok",
		isError: false,
		speakableText: renderRoutineReply(
			routine,
			language,
			args,
			speakables.join(" "),
		),
	}
}

const callBuiltinTool = async (
	domiaId: string,
	rawName: string,
	args: Record<string, unknown>,
	hooks: SkillConnHooksType | undefined,
	signal?: AbortSignal,
): Promise<SkillCallResultType> => {
	const runtime = runtimePort()
	const domia = await runtime.domiaOf(domiaId)
	if (!domia)
		return failure("The identity for this tool is not hosted here.", "")
	const routine = routineForTool(domiaId, rawName)
	if (routine) return runRoutine(domia, routine, args, hooks, signal)
	const tool = toolByName(rawName)
	if (!tool) return failure(`Unknown built-in tool "${rawName}".`, "")
	const language = domia.characterProfile?.language ?? null
	const sets = languageSetsFor(language)
	const trace = getTraceContext()
	const origin = runtime.originCapabilities(
		domia,
		trace?.satelliteId,
		BUILTIN_SOURCE,
	)
	const parsed = tool.schema.safeParse(args)
	if (!parsed.success) {
		skillEngineLogger.warn("built-in tool rejected its arguments", {
			tool: rawName,
			issues: parsed.error.issues.map((i) => i.message),
		})
		return failure(
			`Invalid arguments for "${rawName}": ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
			sets.phrases.cantDoThat,
		)
	}
	if (tool.available && !tool.available(origin, { domiaId, runtime }))
		return failure(
			`"${rawName}" is not available from this device.`,
			sets.phrases.notAvailableHere,
		)
	return tool.execute(parsed.data, {
		domia,
		language,
		sets,
		interactionId: trace?.interactionId ?? null,
		originDomiaKey: trace?.originDomiaKey ?? domia.domiaKey,
		origin,
		runtime,
		signal,
	})
}

export const builtinAdapter: SkillAdapterType = {
	protocol: SKILL_PROTOCOL_ENUM.BUILTIN,
	transports: MCP_TRANSPORT_ENUM_VALUES,
	connect: (cfg, hooks) => {
		const handle: SkillConnHandleType = {
			listTools: () =>
				Promise.resolve({
					tools: [
						...DOMIA_TOOLS.map((tool) => tool.definition),
						...activeRoutinesOf(cfg.domiaId).map(routineToolDefinition),
					],
				}),
			callTool: (rawName, args, signal) =>
				callBuiltinTool(cfg.domiaId, rawName, args, hooks, signal),
			protocolEra: () => null,
			close: () => Promise.resolve(),
		}
		return Promise.resolve(handle)
	},
}
