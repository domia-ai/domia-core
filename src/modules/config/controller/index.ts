import { existsSync, readdirSync } from "fs"
import { resolve } from "path"
import { dbClient } from "@/db"
import { type DomiaType, getOwnDomia, invalidateOwnDomia } from "@/modules/core"
import { getEmotionVectorFromEmotionState } from "@/modules/emotion-engine"
import { getBootStatus, requestRestart } from "@/modules/runtime-control"
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
	const stt = domia.sttConfig
	if (stt)
		entries.push({
			stage: "stt",
			engine: stt.engine,
			configured: stt.modelName,
			path: stt.modelPath,
			status: dirInstalled(stt.modelPath) ? "ok" : "missing",
		})
	const tts = domia.ttsConfig
	if (tts)
		entries.push({
			stage: "tts",
			engine: tts.engine,
			configured: tts.voiceName,
			path: tts.modelPath,
			status: dirInstalled(tts.modelPath) ? "ok" : "missing",
		})
	const ww = domia.wakeWordConfig
	if (ww) {
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
			configured: "silero",
			path: ww.vadModelPath,
			status: fileInstalled(ww.vadModelPath) ? "ok" : "missing",
		})
	}
	const llm = domia.llmModelConfig
	if (llm)
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
	return { ok: entries.every((e) => e.status !== "missing"), entries }
}

export const serializeConfig = (domia: DomiaType): ConfigSnapshotType => ({
	domia: {
		name: domia.name,
		isActive: domia.isActive,
		sessionIdTimeoutMs: domia.sessionIdTimeoutMs,
		memoryWindowTurns: domia.memoryWindowTurns,
		memoryMaxAgeMs: domia.memoryMaxAgeMs,
		maxConcurrentVoiceReplies: domia.maxConcurrentVoiceReplies,
		maxQueuedVoiceReplies: domia.maxQueuedVoiceReplies,
		voiceQueueTimeoutMs: domia.voiceQueueTimeoutMs,
		ownConfigTtlMs: domia.ownConfigTtlMs,
	},
	character: domia.characterProfile,
	emotion: domia.emotionState
		? getEmotionVectorFromEmotionState(domia.emotionState)
		: null,
	modules: domia.moduleSettings,
	capabilities: domia.runtimeCapabilities,
	stt: domia.sttConfig,
	tts: domia.ttsConfig,
	llm: domia.llmModelConfig,
	wakeWord: domia.wakeWordConfig,
	playback: domia.audioPlaybackConfig,
	mqttLocal: domia.localMqttConfig,
	mqttRemote: domia.remoteMqttConfig,
	mcpServers: domia.mcpServerConfigs ?? [],
	delegations: domia.capabilityDelegations ?? [],
})

export const persistConfig = async (
	domia: DomiaType,
	input: unknown,
): Promise<{ config: ConfigSnapshotType }> => {
	const bundle = configBundleSchema.parse(input)
	if (bundle.version && bundle.version > CONFIG_BUNDLE_VERSION)
		throw new Error(
			`Unsupported config bundle version ${bundle.version} (this node supports up to ${CONFIG_BUNDLE_VERSION})`,
		)
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
			dbAdapter.materializeMqtt(domia.id, "LOCAL", bundle.mqttLocal, tx).run()
		if (bundle.mqttRemote)
			dbAdapter.materializeMqtt(domia.id, "REMOTE", bundle.mqttRemote, tx).run()
		if (bundle.mcpServers)
			dbAdapter.replaceMcpServers(domia.id, bundle.mcpServers, tx)
		if (bundle.delegations)
			dbAdapter.replaceDelegations(domia.id, bundle.delegations, tx)
	})
	invalidateOwnDomia()
	const fresh = (await getOwnDomia()) ?? domia
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
