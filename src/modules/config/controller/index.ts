import { existsSync, readdirSync } from "fs"
import { resolve } from "path"
import { getTableColumns } from "drizzle-orm"
import {
	dbClient,
	domia as domiaTable,
	STT_ENGINE_ENUM,
	VOLUME_PERCENT_SCALE,
} from "@/db"
import { type DomiaType, getOwnDomia, invalidateOwnDomia } from "@/modules/core"
import { getEmotionVectorFromEmotionState } from "@/modules/emotion-engine"
import { getBootStatus } from "@/modules/runtime-control"
import { getAecStatus } from "@/modules/aec"
import { setGrpcClientTunables } from "@/modules/grpc-client"
import {
	resolveSkillAdapter,
	ensureBuiltinProvider,
	isBuiltinProvider,
} from "@/modules/skill-engine"
import { slotStats } from "@/modules/llm-slots"
import {
	configEngineLogger,
	domiaError,
	setMeshAuthTunables,
	VALIDATION_ERRORS,
} from "@/utils"
import dbAdapter from "../db-adapter"
import { DOMIA_BUNDLE_OMIT_KEYS } from "../constants"
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
	if (stt && caps?.stt) {
		const remoteStt =
			stt.engine === STT_ENGINE_ENUM.NEMO_SPEECH ||
			stt.engine === STT_ENGINE_ENUM.OPENAI_COMPATIBLE
		entries.push({
			stage: "stt",
			engine: stt.engine,
			configured: stt.modelName,
			path: remoteStt ? stt.baseUrl : stt.modelPath,
			status: remoteStt
				? stt.baseUrl?.trim()
					? "ok"
					: "missing"
				: dirInstalled(stt.modelPath)
					? "ok"
					: "missing",
		})
	}
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
		if (ww.denoiseEnabled)
			entries.push({
				stage: "denoise",
				engine: ww.denoiseEngine,
				configured: ww.denoiseEngine,
				path: ww.denoiseModelPath,
				status: fileInstalled(ww.denoiseModelPath) ? "ok" : "missing",
				detail: fileInstalled(ww.denoiseModelPath)
					? undefined
					: `npm run setup:models:${ww.denoiseEngine.toLowerCase()}`,
			})
		if (ww.aecEnabled) {
			const aec = getAecStatus()
			entries.push({
				stage: "aec",
				engine: aec.backend,
				configured: ww.aecSourceName,
				path: null,
				status:
					aec.state === "active"
						? "ok"
						: aec.state === "off"
							? "unknown"
							: "missing",
				detail: aec.detail ?? `state=${aec.state}`,
			})
		}
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
	const builtinOn = domia.moduleSettings?.builtinTools === true
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
	else if (skillsOn && providers.every(isBuiltinProvider))
		entries.push({
			stage: "skills",
			engine: null,
			configured: null,
			path: null,
			status: "ok",
			detail: "No MCP providers yet — only the built-in tools are loaded",
		})
	for (const p of providers) {
		let status: ConfigHealthEntryType["status"] = "ok"
		let detail: string | undefined
		if (!resolveSkillAdapter(p.protocol)) {
			status = "missing"
			detail = `Unsupported protocol '${p.protocol}' — no adapter installed`
		} else if (isBuiltinProvider(p) ? !builtinOn : !skillsOn) {
			status = "unknown"
			detail = isBuiltinProvider(p)
				? "Built-in tools are off — the native provider is not loaded"
				: "Skills engine is off — this provider is not loaded"
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
	return {
		ok: entries.every((e) => e.status !== "missing"),
		entries,
		llmSlots: { ...slotStats() },
	}
}

const SECTION_META_KEYS = new Set([
	"id",
	"domiaId",
	"isActive",
	"createdAt",
	"updatedAt",
])

const SNAPSHOT_SECRET_KEYS = ["apiKey", "password"] as const

const stripSectionSecrets = (section: unknown): unknown => {
	if (!section || typeof section !== "object" || Array.isArray(section))
		return section
	const entries = Object.entries(section as Record<string, unknown>).filter(
		([key]) =>
			!SNAPSHOT_SECRET_KEYS.includes(
				key as (typeof SNAPSHOT_SECRET_KEYS)[number],
			),
	)
	return Object.fromEntries(entries)
}

export const stripDomiaSnapshotSecrets = <T>(snapshot: T): T => {
	if (!snapshot || typeof snapshot !== "object") return snapshot
	const clone: Record<string, unknown> = {
		...(snapshot as Record<string, unknown>),
	}
	for (const key of Object.keys(clone))
		clone[key] = stripSectionSecrets(clone[key])
	return clone as T
}

const bundleSection = (
	row: object,
	extraOmit: readonly string[] = [],
): Record<string, unknown> =>
	Object.fromEntries(
		Object.entries(row).filter(
			([key]) => !SECTION_META_KEYS.has(key) && !extraOmit.includes(key),
		),
	)

const toBundleSection = (
	row: object | null | undefined,
	extraOmit: readonly string[] = [],
): Record<string, unknown> | null =>
	row ? bundleSection(row, extraOmit) : null

const DOMIA_COLUMN_KEYS = Object.keys(getTableColumns(domiaTable))

const domiaRow = (row: DomiaType): Record<string, unknown> =>
	Object.fromEntries(
		DOMIA_COLUMN_KEYS.map((key) => [
			key,
			(row as unknown as Record<string, unknown>)[key],
		]),
	)

export const serializeConfig = (domia: DomiaType): ConfigSnapshotType =>
	({
		version: CONFIG_BUNDLE_VERSION,
		domia: bundleSection(domiaRow(domia), DOMIA_BUNDLE_OMIT_KEYS),
		character: toBundleSection(domia.characterProfile),
		emotion: domia.emotionState
			? getEmotionVectorFromEmotionState(domia.emotionState)
			: null,
		modules: toBundleSection(domia.moduleSettings),
		capabilities: toBundleSection(domia.runtimeCapabilities),
		stt: toBundleSection(domia.sttConfig, ["apiKey"]),
		tts: toBundleSection(domia.ttsConfig),
		llm: toBundleSection(domia.llmModelConfig, ["apiKey"]),
		wakeWord: toBundleSection(domia.wakeWordConfig),
		playback: toBundleSection(domia.audioPlaybackConfig),
		mqttLocal: toBundleSection(domia.localMqttConfig, ["type", "password"]),
		skillProviders: (domia.skillProviders ?? []).map((s) => {
			const section = bundleSection(s, ["auth"])
			section.id = s.id
			if (s.auth?.kind) section.auth = { kind: s.auth.kind }
			return section
		}),
		delegations: (domia.capabilityDelegations ?? []).map((d) =>
			bundleSection(d),
		),
	}) as ConfigSnapshotType

export const clampVolumePercent = (level: number): number =>
	Math.min(VOLUME_PERCENT_SCALE, Math.max(0, Math.round(level)))

export const setPlaybackVolume = (domia: DomiaType, volume: number): number => {
	const level = clampVolumePercent(volume)
	dbClient.transaction((tx) => {
		dbAdapter.materializePlayback(domia.id, { volume: level }, tx).run()
		dbAdapter.bumpConfigRevision(domia.id, tx).run()
	})
	invalidateOwnDomia(domia.domiaKey)
	configEngineLogger.info("🔊 playback volume persisted", {
		domiaId: domia.id,
		volume: level,
	})
	return level
}

export const persistConfig = async (
	domia: DomiaType,
	input: unknown,
): Promise<{ config: ConfigSnapshotType }> => {
	const rawVersion =
		typeof input === "object" && input !== null
			? (input as { version?: unknown }).version
			: undefined
	if (typeof rawVersion === "number" && rawVersion > CONFIG_BUNDLE_VERSION)
		throw domiaError(VALIDATION_ERRORS.UNSUPPORTED_CONFIG_VERSION, {
			meta: { version: rawVersion, supported: CONFIG_BUNDLE_VERSION },
		})
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
		if (bundle.skillProviders) {
			dbAdapter.replaceSkillProviders(domia.id, bundle.skillProviders, tx)
			ensureBuiltinProvider(domia.id, tx)
		}
		if (bundle.delegations)
			dbAdapter.replaceDelegations(domia.id, bundle.delegations, tx)
		dbAdapter.bumpConfigRevision(domia.id, tx).run()
	})
	invalidateOwnDomia(domia.domiaKey)
	const fresh = (await getOwnDomia(domia.domiaKey)) ?? domia
	setGrpcClientTunables(fresh)
	setMeshAuthTunables(fresh)
	configEngineLogger.info("📥 config persisted", { domiaId: domia.id })
	return { config: serializeConfig(fresh) }
}
