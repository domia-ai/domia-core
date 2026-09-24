import {
	DEFAULT_SKILL_LIST_CHANGED_DEBOUNCE_MS,
	type SelectSkillProviderType,
} from "@/db"
import { skillEngineLogger, domiaError, SKILL_ERRORS } from "@/utils"

import type {
	SkillConnHooksType,
	SkillElicitResultType,
	SkillsRefreshOptionsType,
	SkillRuntimePortType,
} from "../types"

import { connections } from "./state"
import { callTool } from "./call-tool"

const refreshHooks = new Map<string, (opts: SkillsRefreshOptionsType) => void>()
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
const elicitPresenters = new Map<
	string,
	(
		message: string,
		requestedSchema: Record<string, unknown> | undefined,
	) => Promise<SkillElicitResultType>
>()

let skillRuntimePort: SkillRuntimePortType | null = null

export const setSkillRuntimePort = (port: SkillRuntimePortType): void => {
	skillRuntimePort = port
}

export const runtimePortOrNull = (): SkillRuntimePortType | null =>
	skillRuntimePort

export const runtimePort = (): SkillRuntimePortType => {
	if (!skillRuntimePort)
		throw domiaError(SKILL_ERRORS.RUNTIME_PORT_UNSET, {
			logger: skillEngineLogger,
		})
	return skillRuntimePort
}

export const setSkillsRefreshHook = (
	domiaId: string,
	fn: (opts: SkillsRefreshOptionsType) => void,
): void => {
	refreshHooks.set(domiaId, fn)
}

export const clearSkillsRefreshHook = (domiaId: string): void => {
	refreshHooks.delete(domiaId)
	const timer = refreshTimers.get(domiaId)
	if (timer) clearTimeout(timer)
	refreshTimers.delete(domiaId)
}

export const setElicitationPresenter = (
	domiaId: string,
	fn: (
		message: string,
		requestedSchema: Record<string, unknown> | undefined,
	) => Promise<SkillElicitResultType>,
): void => {
	elicitPresenters.set(domiaId, fn)
}

export const clearElicitationPresenter = (domiaId: string): void => {
	elicitPresenters.delete(domiaId)
}

export const invalidateToolList = (domiaId: string): void => {
	for (const conn of connections.values())
		if (conn.provider.domiaId === domiaId) conn.toolsFreshUntil = null
	if (refreshTimers.has(domiaId)) return
	const timer = setTimeout(() => {
		refreshTimers.delete(domiaId)
		refreshHooks.get(domiaId)?.({ force: true })
	}, DEFAULT_SKILL_LIST_CHANGED_DEBOUNCE_MS)
	if (typeof timer.unref === "function") timer.unref()
	refreshTimers.set(domiaId, timer)
}

export const connHooksFor = (
	cfg: SelectSkillProviderType,
): SkillConnHooksType => ({
	onToolListChanged: () => invalidateToolList(cfg.domiaId),
	onElicit: async (message, requestedSchema) => {
		const presenter = elicitPresenters.get(cfg.domiaId)
		if (!presenter) return { action: "decline" }
		try {
			return await presenter(message, requestedSchema)
		} catch (err) {
			skillEngineLogger.warn("elicitation presenter failed", {
				provider: cfg.name,
				err,
			})
			return { action: "cancel" }
		}
	},
	invokeTool: (namespacedName, args, signal, step) =>
		callTool(cfg.domiaId, namespacedName, args, signal, true, {
			sequence: step?.stepIndex,
			routineSlug: step?.routineSlug,
			stepIndex: step?.stepIndex,
		}),
})
