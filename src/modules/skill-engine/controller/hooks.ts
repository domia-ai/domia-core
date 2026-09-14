import {
	DEFAULT_SKILL_LIST_CHANGED_DEBOUNCE_MS,
	type SelectSkillProviderType,
} from "@/db"
import { skillEngineLogger } from "@/utils"

import type {
	SkillConnHooksType,
	SkillElicitResultType,
	SkillsRefreshOptionsType,
} from "../types"

import { connections } from "./state"

const refreshHooks = new Map<string, (opts: SkillsRefreshOptionsType) => void>()
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
const elicitPresenters = new Map<
	string,
	(
		message: string,
		requestedSchema: Record<string, unknown> | undefined,
	) => Promise<SkillElicitResultType>
>()

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
})
