import { getOwnDomia, getHostedDomias } from "@/modules/core"
import { persistConfig } from "@/modules/config"
import { getActiveTurn, abortAndWait } from "@/modules/core-bus"
import {
	activeVoiceReplies,
	queuedVoiceReplies,
} from "@/modules/voice-admission"
import { requestRestart } from "@/modules/runtime-control"
import { clearLlmClientCache } from "@/modules/llm-engine"
import { createAsyncSemaphore } from "@/utils"
import { DEFAULT_CONFIG_RELOAD_DRAIN_MS } from "@/db"
import {
	createApplyState,
	createConfigApplyEngine,
	createReloadRunner,
} from "../utils"
import type {
	ReloadSubsystemType,
	ConfigReloaderType,
	BusyCheckType,
	ConfigApplyStateType,
} from "../types"

const mutexes = new Map<string, ReturnType<typeof createAsyncSemaphore>>()

const runExclusive = async <T>(
	key: string,
	fn: () => Promise<T>,
): Promise<T> => {
	const mutex = mutexes.get(key) ?? createAsyncSemaphore(1)
	mutexes.set(key, mutex)
	const release = await mutex.acquire()
	try {
		return await fn()
	} finally {
		release()
	}
}

const reloaders = new Map<ReloadSubsystemType, ConfigReloaderType>()

export const registerReloader = (
	subsystem: ReloadSubsystemType,
	reloader: ConfigReloaderType,
): void => {
	reloaders.set(subsystem, reloader)
}

const busyChecks = new Set<BusyCheckType>()

export const registerBusyCheck = (check: BusyCheckType): void => {
	busyChecks.add(check)
}

const applyState = createApplyState()

export const getApplyState = (domiaKey: string): ConfigApplyStateType =>
	applyState.snapshot(domiaKey)

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

const isIdle = (domiaId: string): boolean => {
	if (getActiveTurn(domiaId) !== null) return false
	if (activeVoiceReplies(domiaId) > 0 || queuedVoiceReplies(domiaId) > 0)
		return false
	for (const check of busyChecks) if (check(domiaId)) return false
	return true
}

const quiesce = async (
	domiaIds: string[],
	timeoutMs: number,
): Promise<void> => {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline && domiaIds.some((id) => !isIdle(id)))
		await sleep(100)
	for (const id of domiaIds)
		if (!isIdle(id)) await abortAndWait(id, "config-reload")
}

const engine = createConfigApplyEngine({
	state: applyState,
	runner: createReloadRunner({
		state: applyState,
		hostedIds: async () => (await getHostedDomias()).map((d) => d.id),
		resolveLatest: (domiaKey) => getOwnDomia(domiaKey),
		quiesce,
		runExclusive,
	}),
	reloaderFor: (subsystem) => reloaders.get(subsystem),
	persist: (domia, input) => persistConfig(domia, input),
	resolve: (domiaKey) => getOwnDomia(domiaKey),
	quiesce,
	runExclusive,
	onLlmClientStale: () => clearLlmClientCache(),
	requestRestart: () => requestRestart(),
	defaultDrainMs: DEFAULT_CONFIG_RELOAD_DRAIN_MS,
})

export const { applyConfig, reloadSubsystem } = engine
