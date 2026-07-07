import { type DomiaType, getOwnDomia, getHostedDomias } from "@/modules/core"
import { persistConfig } from "@/modules/config"
import { getActiveTurn, abortActiveTurn } from "@/modules/core-bus"
import {
	activeVoiceReplies,
	queuedVoiceReplies,
} from "@/modules/voice-admission"
import { requestRestart } from "@/modules/runtime-control"
import { clearLlmClientCache } from "@/modules/llm-engine"
import { createAsyncSemaphore, appLogger } from "@/utils"
import { DEFAULT_CONFIG_RELOAD_DRAIN_MS } from "@/db"
import type {
	ReloadSubsystemType,
	ReloaderScopeType,
	ConfigChangeType,
	ConfigApplyPlanType,
	ConfigReloaderType,
	BusyCheckType,
	ConfigApplyResultType,
	SubsystemOutcomeType,
	ChangeActionType,
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

const runningRevisions = new Map<string, number>()

const setRunning = (
	domiaKey: string,
	subsystem: ReloadSubsystemType,
	revision: number,
): void => {
	runningRevisions.set(`${domiaKey}:${subsystem}`, revision)
}

const RELOAD_SCOPE: Record<ReloadSubsystemType, ReloaderScopeType> = {
	"stt-pool": "global",
	"tts-pool": "global",
	mqtt: "global",
	"voice-listener": "per-identity",
	skills: "per-identity",
	satellites: "per-identity",
	identity: "per-identity",
}

const DOMIA_FIELDS = [
	"sessionIdTimeoutMs",
	"memoryWindowTurns",
	"memoryMaxAgeMs",
	"maxConcurrentVoiceReplies",
	"maxQueuedVoiceReplies",
	"voiceQueueTimeoutMs",
	"ownConfigTtlMs",
	"warmupOnBoot",
	"isHosted",
	"grpcUnaryDeadlineMs",
	"grpcStreamIdleTimeoutMs",
	"grpcStreamDeadlineMs",
	"peerStaleAfterMs",
]

const SECTION_PROPS: { section: string; prop: string }[] = [
	{ section: "character", prop: "characterProfile" },
	{ section: "emotion", prop: "emotionState" },
	{ section: "modules", prop: "moduleSettings" },
	{ section: "capabilities", prop: "runtimeCapabilities" },
	{ section: "stt", prop: "sttConfig" },
	{ section: "tts", prop: "ttsConfig" },
	{ section: "llm", prop: "llmModelConfig" },
	{ section: "wakeWord", prop: "wakeWordConfig" },
	{ section: "playback", prop: "audioPlaybackConfig" },
	{ section: "mqttLocal", prop: "localMqttConfig" },
]

const META = new Set([
	"id",
	"domiaId",
	"createdAt",
	"updatedAt",
	"isActive",
	"name",
])

const arrayChangedById = (
	a: unknown[] | null,
	b: unknown[] | null,
	idKey: string,
): boolean => {
	const norm = (arr: unknown[] | null): Map<string, string> => {
		const map = new Map<string, string>()
		for (const item of arr ?? []) {
			const id = String((item as Record<string, unknown>)[idKey])
			map.set(id, JSON.stringify(item))
		}
		return map
	}
	const ma = norm(a)
	const mb = norm(b)
	if (ma.size !== mb.size) return true
	for (const [k, v] of ma) if (mb.get(k) !== v) return true
	return false
}

const delegationKey = (item: unknown): string => {
	const d = item as Record<string, unknown>
	return `${d.capability}|${d.delegateToDomiaKey}|${d.priority}|${d.isActive}`
}

const setChangedByKey = (
	a: unknown[] | null,
	b: unknown[] | null,
	keyOf: (item: unknown) => string,
): boolean => {
	const norm = (arr: unknown[] | null): Map<string, number> => {
		const map = new Map<string, number>()
		for (const item of arr ?? []) {
			const k = keyOf(item)
			map.set(k, (map.get(k) ?? 0) + 1)
		}
		return map
	}
	const ma = norm(a)
	const mb = norm(b)
	if (ma.size !== mb.size) return true
	for (const [k, v] of ma) if (mb.get(k) !== v) return true
	return false
}

const diffConfig = (
	oldDomia: DomiaType,
	newDomia: DomiaType,
): ConfigChangeType[] => {
	const changes: ConfigChangeType[] = []
	const o = oldDomia as unknown as Record<string, unknown>
	const n = newDomia as unknown as Record<string, unknown>
	for (const field of DOMIA_FIELDS)
		if (o[field] !== n[field]) changes.push({ section: "domia", field })
	for (const { section, prop } of SECTION_PROPS) {
		const oo = (o[prop] ?? {}) as Record<string, unknown>
		const nn = (n[prop] ?? {}) as Record<string, unknown>
		for (const field of new Set([...Object.keys(oo), ...Object.keys(nn)])) {
			if (META.has(field)) continue
			if (oo[field] !== nn[field]) changes.push({ section, field })
		}
	}
	if (arrayChangedById(oldDomia.skillProviders, newDomia.skillProviders, "id"))
		changes.push({ section: "skillProviders", field: "*" })
	if (
		setChangedByKey(
			oldDomia.capabilityDelegations,
			newDomia.capabilityDelegations,
			delegationKey,
		)
	)
		changes.push({ section: "delegations", field: "*" })
	return changes
}

const STT_LIVE = new Set([
	"language",
	"silenceThreshold",
	"bufferSize",
	"timeoutMs",
	"enableEndpoint",
	"decodePaddingMs",
	"rule1MinTrailingSilence",
	"rule2MinTrailingSilence",
	"rule3MinUtteranceLength",
])
const TTS_LIVE = new Set([
	"voiceName",
	"language",
	"pitch",
	"speed",
	"silenceScale",
	"streamingEnabled",
	"sentenceSoftFlushMinChars",
	"sentenceFirstUnitMaxWords",
	"sentenceMediumFlushChars",
	"sentenceHardFlushChars",
	"sentenceFirstFlushMaxMs",
	"pipelineMaxQueueDepth",
	"pipelineEagerTtsSentences",
])
const LLM_DRAIN = new Set(["engine", "baseUrl", "apiKey"])
const CAP_LIVE_DRAIN = new Set(["stt", "tts", "playback"])

const classifyChange = (section: string, field: string): ChangeActionType => {
	switch (section) {
		case "domia":
			return field === "isHosted" ? "identity" : "live"
		case "capabilities":
			if (field === "wakeword" || field === "record") return "voice-listener"
			return CAP_LIVE_DRAIN.has(field) ? "live-drain" : "live"
		case "modules":
			return field === "skillsEngine" ? "skills" : "live"
		case "wakeWord":
			return "voice-listener"
		case "mqttLocal":
			return "mqtt"
		case "skillProviders":
			return "skills"
		case "stt":
			return STT_LIVE.has(field) ? "live" : "stt-pool"
		case "tts":
			return TTS_LIVE.has(field) ? "live" : "tts-pool"
		case "llm":
			return LLM_DRAIN.has(field) ? "live-drain" : "live"
		case "character":
		case "emotion":
		case "delegations":
			return "live"
		case "playback":
			return "live-drain"
		default:
			return "restart"
	}
}

const classify = (changes: ConfigChangeType[]): ConfigApplyPlanType => {
	const reloads = new Map<ReloadSubsystemType, ReloaderScopeType>()
	let live = false
	let liveDrain = false
	let identity = false
	let restart = false
	for (const { section, field } of changes) {
		const action = classifyChange(section, field)
		if (action === "live") live = true
		else if (action === "live-drain") liveDrain = true
		else if (action === "identity") identity = true
		else if (action === "restart") restart = true
		else reloads.set(action, RELOAD_SCOPE[action])
	}
	return { live, liveDrain, reloads, identity, restart }
}

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
		if (!isIdle(id)) abortActiveTurn(id, "config-reload")
}

const runReloader = async (
	subsystem: ReloadSubsystemType,
	scope: ReloaderScopeType,
	reloader: ConfigReloaderType,
	newDomia: DomiaType,
	domiaKey: string,
	desiredRevision: number,
	drainMs: number,
	drained: Set<string>,
	outcomes: SubsystemOutcomeType[],
): Promise<void> => {
	const mutexKey =
		scope === "global" ? `sub:${subsystem}` : `sub:${subsystem}:${domiaKey}`
	await runExclusive(mutexKey, async () => {
		const ids =
			scope === "global"
				? (await getHostedDomias()).map((d) => d.id)
				: [newDomia.id]
		await quiesce(ids, drainMs)
		ids.forEach((id) => drained.add(id))
		try {
			const latest = (await getOwnDomia(domiaKey)) ?? newDomia
			if (latest.configRevision !== desiredRevision) {
				outcomes.push({ subsystem, status: "skipped" })
				return
			}
			await reloader.reload(latest, domiaKey)
			setRunning(domiaKey, subsystem, latest.configRevision)
			outcomes.push({
				subsystem,
				status: "reloaded",
				runningRevision: latest.configRevision,
			})
		} catch (err) {
			outcomes.push({
				subsystem,
				status: "failed",
				error: err instanceof Error ? err.message : String(err),
			})
		}
	})
}

export const reloadSubsystem = async (
	subsystem: ReloadSubsystemType,
	domiaKey: string,
): Promise<ConfigApplyResultType> => {
	return runExclusive(`apply:${domiaKey}`, async () => {
		const domia = await getOwnDomia(domiaKey)
		const drainMs = domia?.configReloadDrainMs ?? DEFAULT_CONFIG_RELOAD_DRAIN_MS
		const outcomes: SubsystemOutcomeType[] = []
		const drained = new Set<string>()
		const reloader = reloaders.get(subsystem)
		if (!reloader || !domia) {
			appLogger.warn("⚙️ subsystem reload needs restart (unregistered)", {
				subsystem,
				domiaKey,
			})
			requestRestart()
			return {
				result: "restart",
				desiredRevision: domia?.configRevision ?? 0,
				subsystems: [{ subsystem, status: "skipped" }],
				drained: [],
			}
		}
		await runReloader(
			subsystem,
			RELOAD_SCOPE[subsystem],
			reloader,
			domia,
			domiaKey,
			domia.configRevision,
			drainMs,
			drained,
			outcomes,
		)
		const failed = outcomes.some((o) => o.status === "failed")
		const skipped = outcomes.some((o) => o.status === "skipped")
		const reloaded = outcomes.some((o) => o.status === "reloaded")
		return {
			result: failed || skipped ? "partial" : reloaded ? "reloaded" : "live",
			desiredRevision: domia.configRevision,
			subsystems: outcomes,
			drained: [...drained],
		}
	})
}

export const applyConfig = async (
	oldDomia: DomiaType,
	input: unknown,
): Promise<{ config: unknown; apply: ConfigApplyResultType }> => {
	const domiaKey = oldDomia.domiaKey
	return runExclusive(`apply:${domiaKey}`, async () => {
		const { config } = await persistConfig(oldDomia, input)
		const newDomia = (await getOwnDomia(domiaKey)) ?? oldDomia
		const desiredRevision = newDomia.configRevision
		const drainMs =
			newDomia.configReloadDrainMs ?? DEFAULT_CONFIG_RELOAD_DRAIN_MS
		const changes = diffConfig(oldDomia, newDomia)
		const plan = classify(changes)
		const llmClientStale = changes.some(
			(c) => c.section === "llm" && LLM_DRAIN.has(c.field),
		)
		const outcomes: SubsystemOutcomeType[] = []
		const drained = new Set<string>()
		let restartFallback = plan.restart

		if (plan.live)
			outcomes.push({
				subsystem: "config",
				status: "live",
				runningRevision: desiredRevision,
			})

		if (plan.liveDrain) {
			await quiesce([newDomia.id], drainMs)
			if (llmClientStale) clearLlmClientCache()
			drained.add(newDomia.id)
			outcomes.push({
				subsystem: "live-drain",
				status: "live",
				runningRevision: desiredRevision,
			})
		}

		for (const [subsystem, scope] of plan.reloads) {
			const reloader = reloaders.get(subsystem)
			if (!reloader) {
				restartFallback = true
				outcomes.push({ subsystem, status: "skipped" })
				continue
			}
			await runReloader(
				subsystem,
				scope,
				reloader,
				newDomia,
				domiaKey,
				desiredRevision,
				drainMs,
				drained,
				outcomes,
			)
		}

		if (plan.identity) {
			const reloader = reloaders.get("identity")
			if (!reloader) {
				restartFallback = true
				outcomes.push({ subsystem: "identity", status: "skipped" })
			} else {
				await runReloader(
					"identity",
					RELOAD_SCOPE.identity,
					reloader,
					newDomia,
					domiaKey,
					desiredRevision,
					drainMs,
					drained,
					outcomes,
				)
			}
		}

		if (restartFallback) {
			appLogger.warn(
				"⚙️ config apply needs restart (unregistered/structural change)",
				{
					domiaKey,
				},
			)
			requestRestart()
		}

		const failed = outcomes.some((o) => o.status === "failed")
		const skippedAny = outcomes.some((o) => o.status === "skipped")
		const reloadedAny = outcomes.some((o) => o.status === "reloaded")
		const result: ConfigApplyResultType["result"] = restartFallback
			? "restart"
			: failed || skippedAny
				? "partial"
				: reloadedAny
					? "reloaded"
					: "live"

		appLogger.info(`⚙️ config applied → ${result}`, {
			domiaKey,
			desiredRevision,
			subsystems: outcomes.map((o) => `${o.subsystem}:${o.status}`),
		})

		return {
			config,
			apply: {
				result,
				desiredRevision,
				subsystems: outcomes,
				drained: [...drained],
			},
		}
	})
}
