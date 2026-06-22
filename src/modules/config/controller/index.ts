import { existsSync, readdirSync } from "fs"
import { resolve } from "path"
import { dbClient } from "@/db"
import { type DomiaType, getOwnDomia, invalidateOwnDomia } from "@/modules/core"
import { getEmotionVectorFromEmotionState } from "@/modules/emotion-engine"
import { getBootStatus, requestRestart } from "@/modules/runtime-control"
import { setGrpcClientTunables } from "@/modules/grpc-client"
import { resolveSkillAdapter } from "@/modules/skill-engine"
import { configEngineLogger } from "@/utils"
import dbAdapter from "../db-adapter"
import { CONFIG_BUNDLE_VERSION, configBundleSchema } from "../schemas"
import type {
	ConfigHealthEntryType,
	ConfigHealthType,
	ConfigSnapshotType,
} from "../types"

const dirInstalled = (path: string | null | undefined): boolean => {
	if (!path) return false
	try {
		const r = resolve(path)
		return existsSync(r) && readdirSync(r).length > 0
	} catch {
		return false
	}
}

const fileInstalled = (path: string | null | undefined): boolean => {
	if (!path) return false
	try {
		return existsSync(resolve(path))
	} catch {
		return false
	}
}

export const configHealth = (domia: DomiaType): ConfigHealthType => {
	const entries: ConfigHealthEntryType[] = []
	const caps = domia.runtimeCapabilities
	const stt = domia.sttConfig
	if (stt && caps?.stt)
		entries.push({
			stage: "stt",
			engine: stt.engine,
			configured: stt.modelName,
			path: stt.modelPath,
			status: dirInstalled(stt.modelPath) ? "ok" : "missing",
		})
	const tts = domia.ttsConfig
	if (tts && caps?.tts)
		entries.push({
			stage: "tts",
			engine: tts.engine,
			configured: tts.voiceName,
			path: tts.modelPath,
			status: dirInstalled(tts.modelPath) ? "ok" : "missing",
		})
	const ww = domia.wakeWordConfig
	if (ww && caps?.wakeword) {
		entries.push({
			stage: "wakeWord",
			engine: ww.engine,
			configured: ww.model,
			path: ww.customModelPath,
			status: dirInstalled(ww.customModelPath) ? "ok" : "missing",
		})
		entries.push({
			stage: "vad",
			engine: ww.vadEngine,
			configured: ww.vadEngine,
			path: ww.vadModelPath,
			status: fileInstalled(ww.vadModelPath) ? "ok" : "missing",
		})
	}
	const llm = domia.llmModelConfig
	if (llm && caps?.llm)
		entries.push({
			stage: "llm",
			engine: llm.engine,
			configured: llm.modelName,
			path: null,
			status: "unknown",
			detail: "Verify the model is pulled (e.g. `ollama list`)",
		})
	const boot = getBootStatus()
	for (const bin of boot.missingBinaries)
		entries.push({
			stage: "binary",
			engine: null,
			configured: bin,
			path: null,
			status: "missing",
			detail: `Install '${bin}' and restart`,
		})
	if (boot.voice === "disabled-missing")
		entries.push({
			stage: "voice",
			engine: null,
			configured: null,
			path: null,
			status: "missing",
			detail: boot.voiceMissing.join("; "),
		})
	else if (boot.voice === "ok")
		entries.push({
			stage: "voice",
			engine: null,
			configured: null,
			path: null,
			status: "ok",
		})
	const skillsOn = domia.moduleSettings?.skillsEngine === true
	const providers = (domia.skillProviders ?? []).filter((p) => p.isActive)
	if (skillsOn && providers.length === 0)
		entries.push({
			stage: "skills",
			engine: null,
			configured: null,
			path: null,
			status: "unknown",
			detail: "Skills engine is on but no providers are configured",
		})
	for (const p of providers) {
		let status: ConfigHealthEntryType["status"] = "ok"
		let detail: string | undefined
		if (!resolveSkillAdapter(p.protocol)) {
			status = "missing"
			detail = `Unsupported protocol '${p.protocol}' — no adapter installed`
		} else if (!skillsOn) {
			status = "unknown"
			detail = "Skills engine is off — this provider is not loaded"
		} else if (!p.url) {
			status = "missing"
			detail = "Missing endpoint URL"
		} else if (!p.toolsCache?.length) {
			status = "unknown"
			detail =
				"No tools cached — provider unreachable, wrong transport, or missing/invalid auth"
		} else {
			const cached = new Set(p.toolsCache.map((t) => t.rawName))
			const orphanWhitelist = (p.toolWhitelist ?? []).filter(
				(w) => !cached.has(w),
			)
			if (orphanWhitelist.length)
				detail = `Allow-list tools not offered by provider: ${orphanWhitelist.join(", ")}`
		}
		entries.push({
			stage: "skill",
			engine: p.protocol,
			configured: `${p.name} (${p.type}${p.toolsCache?.length ? `, ${p.toolsCache.length} tools` : ""})`,
			path: p.url,
			status,
			detail,
		})
	}
	return { ok: entries.every((e) => e.status !== "missing"), entries }
}

const SECTION_META_KEYS = new Set([
	"id",
	"domiaId",
	"isActive",
	"createdAt",
	"updatedAt",
])

const toBundleSection = <T extends object>(
	row: T | null | undefined,
	extraOmit: string[] = [],
): Record<string, unknown> | null => {
	if (!row) return null
	return Object.fromEntries(
		Object.entries(row).filter(
			([key]) => !SECTION_META_KEYS.has(key) && !extraOmit.includes(key),
		),
	)
}

export const serializeConfig = (domia: DomiaType): ConfigSnapshotType =>
	({
		version: CONFIG_BUNDLE_VERSION,
		domia: {
			name: domia.name,
			sessionIdTimeoutMs: domia.sessionIdTimeoutMs,
			memoryWindowTurns: domia.memoryWindowTurns,
			memoryMaxAgeMs: domia.memoryMaxAgeMs,
			maxConcurrentVoiceReplies: domia.maxConcurrentVoiceReplies,
			maxQueuedVoiceReplies: domia.maxQueuedVoiceReplies,
			voiceQueueTimeoutMs: domia.voiceQueueTimeoutMs,
			ownConfigTtlMs: domia.ownConfigTtlMs,
			warmupOnBoot: domia.warmupOnBoot,
		},
		character: toBundleSection(domia.characterProfile),
		emotion: domia.emotionState
			? getEmotionVectorFromEmotionState(domia.emotionState)
			: null,
		modules: toBundleSection(domia.moduleSettings),
		capabilities: toBundleSection(domia.runtimeCapabilities),
		stt: toBundleSection(domia.sttConfig),
		tts: toBundleSection(domia.ttsConfig),
		llm: toBundleSection(domia.llmModelConfig, ["apiKey"]),
		wakeWord: toBundleSection(domia.wakeWordConfig),
		playback: toBundleSection(domia.audioPlaybackConfig),
		mqttLocal: toBundleSection(domia.localMqttConfig, ["type", "password"]),
		skillProviders: (domia.skillProviders ?? []).map((s) => {
			const section = toBundleSection(s, ["auth"]) as Record<string, unknown>
			section.id = s.id
			if (s.auth?.kind) section.auth = { kind: s.auth.kind }
			return section
		}),
		delegations: (domia.capabilityDelegations ?? []).map(
			(d) => toBundleSection(d) as Record<string, unknown>,
		),
	}) as ConfigSnapshotType

export const persistConfig = async (
	domia: DomiaType,
	input: unknown,
): Promise<{ config: ConfigSnapshotType }> => {
	const rawVersion =
		typeof input === "object" && input !== null
			? (input as { version?: unknown }).version
			: undefined
	if (typeof rawVersion === "number" && rawVersion > CONFIG_BUNDLE_VERSION)
		throw new Error(
			`Unsupported config bundle version ${rawVersion} (this node supports up to ${CONFIG_BUNDLE_VERSION})`,
		)
	const bundle = configBundleSchema.parse(input)
	dbClient.transaction((tx) => {
		if (bundle.domia)
			dbAdapter.materializeDomia(domia.id, bundle.domia, tx).run()
		if (bundle.character)
			dbAdapter.materializeCharacter(domia.id, bundle.character, tx).run()
		if (bundle.emotion)
			dbAdapter.materializeEmotion(domia.id, bundle.emotion, tx).run()
		if (bundle.modules)
			dbAdapter.materializeModules(domia.id, bundle.modules, tx).run()
		if (bundle.capabilities)
			dbAdapter.materializeCapabilities(domia.id, bundle.capabilities, tx).run()
		if (bundle.stt) dbAdapter.materializeStt(domia.id, bundle.stt, tx).run()
		if (bundle.tts) dbAdapter.materializeTts(domia.id, bundle.tts, tx).run()
		if (bundle.llm) dbAdapter.materializeLlm(domia.id, bundle.llm, tx).run()
		if (bundle.wakeWord)
			dbAdapter.materializeWakeWord(domia.id, bundle.wakeWord, tx).run()
		if (bundle.playback)
			dbAdapter.materializePlayback(domia.id, bundle.playback, tx).run()
		if (bundle.mqttLocal)
			dbAdapter.materializeMqtt(domia.id, "LOCAL", bundle.mqttLocal, tx)
		if (bundle.skillProviders)
			dbAdapter.replaceSkillProviders(domia.id, bundle.skillProviders, tx)
		if (bundle.delegations)
			dbAdapter.replaceDelegations(domia.id, bundle.delegations, tx)
	})
	invalidateOwnDomia(domia.domiaKey)
	const fresh = (await getOwnDomia(domia.domiaKey)) ?? domia
	setGrpcClientTunables(fresh)
	configEngineLogger.info("📥 config persisted", { domiaId: domia.id })
	return { config: serializeConfig(fresh) }
}

export const importConfigAndRestart = async (
	domia: DomiaType,
	input: unknown,
): Promise<{ config: ConfigSnapshotType }> => {
	const result = await persistConfig(domia, input)
	requestRestart()
	return result
}
