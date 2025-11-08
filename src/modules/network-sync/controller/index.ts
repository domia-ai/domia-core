import os from "os"

import { dbClient } from "@/db"
import { type DomiaType } from "@/modules/core"
import { networkSyncLogger } from "@/utils"
import dbAdapter from "../db-adapter"
import {
	normalizeDomia,
	normalizeRuntimeCapabilities,
	normalizeCharacterProfile,
	normalizeEmotionState,
	normalizeCapabilityDelegations,
	normalizeLlmModelConfig,
	normalizeMcpServerConfigs,
	normalizeSttConfig,
	normalizeTtsConfig,
} from "../utils"

export const getLocalIp = (): string | null => {
	const interfaces = os.networkInterfaces()

	for (const iface of Object.values(interfaces)) {
		if (!iface) continue

		for (const config of iface) {
			if (config.family === "IPv4" && !config.internal) {
				return config.address
			}
		}
	}

	return null
}

export const upsertDomiaFromNetwork = async (domia: DomiaType) => {
	const domiaId = domia?.id
	const domiaKey = domia?.domiaKey

	const logParams = {
		domiaId,
		domiaKey,
	}

	if (!domiaId || !domiaKey) {
		networkSyncLogger.warn("❌ Missing domiaId or domiaKey, skipping upsert")
		return
	}

	networkSyncLogger.info(
		"Starting database transaction for upsert Domia from network",
		logParams,
	)

	dbClient.transaction((tx) => {
		networkSyncLogger.debug("Upserting domia", logParams)
		dbAdapter.upsertDomia(normalizeDomia(domia), tx).run()

		const runtimeCapabilities = normalizeRuntimeCapabilities(domia)
		if (runtimeCapabilities) {
			networkSyncLogger.debug(
				"Upserting runtime capabilities for Domia",
				logParams,
			)
			dbAdapter.upsertRuntimeCapabilities(runtimeCapabilities, tx).run()
		}

		const characterProfile = normalizeCharacterProfile(domia)
		if (characterProfile) {
			networkSyncLogger.debug(
				"Upserting character profile for Domia",
				logParams,
			)
			dbAdapter.upsertCharacterProfile(characterProfile, tx).run()
		}

		const emotionState = normalizeEmotionState(domia)
		if (emotionState) {
			networkSyncLogger.debug("Upserting emotion state for Domia", logParams)
			dbAdapter.upsertEmotionState(emotionState, tx).run()
		}

		const capabilityDelegations = normalizeCapabilityDelegations(domia)
		if (capabilityDelegations) {
			networkSyncLogger.debug(
				"Upserting capability delegations for Domia",
				logParams,
			)

			for (const capabilityDelegation of capabilityDelegations) {
				dbAdapter.upsertCapabilityDelegation(capabilityDelegation, tx).run()
			}
		}

		const llmModelConfig = normalizeLlmModelConfig(domia)
		if (llmModelConfig) {
			networkSyncLogger.debug("Upserting llm model config for Domia", logParams)
			dbAdapter.upsertLlmModelConfig(llmModelConfig, tx).run()
		}

		const mcpServerConfigs = normalizeMcpServerConfigs(domia)
		if (mcpServerConfigs) {
			networkSyncLogger.debug(
				"Upserting MCP server configs for Domia",
				logParams,
			)

			for (const mcpServerConfig of mcpServerConfigs) {
				dbAdapter.upsertMcpServerConfig(mcpServerConfig, tx).run()
			}
		}

		const sttConfig = normalizeSttConfig(domia)
		if (sttConfig) {
			networkSyncLogger.debug("Upserting stt config for Domia", logParams)
			dbAdapter.upsertSttConfig(sttConfig, tx).run()
		}

		const ttsConfig = normalizeTtsConfig(domia)
		if (ttsConfig) {
			networkSyncLogger.debug("Upserting tts config for Domia", logParams)
			dbAdapter.upsertTtsConfig(ttsConfig, tx).run()
		}
	})
}
