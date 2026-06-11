import os from "os"

import { env } from "@/config"
import { dbClient } from "@/db"
import { type DomiaType } from "@/modules/core"
import { networkSyncLogger } from "@/utils"
import { invalidateCapabilityCache } from "@/modules/capability-resolver"
import dbAdapter from "../db-adapter"
import {
	normalizeDomia,
	normalizeRuntimeCapabilities,
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

export const refreshDomiaLocalIp = (domia: DomiaType): DomiaType => {
	const currentIp = getLocalIp()
	const currentGrpcPort = Number(env.GRPC_PORT) || null
	const ipChanged = currentIp && currentIp !== domia?.localIp
	const grpcPortChanged = currentGrpcPort !== domia?.grpcPort

	if (!ipChanged && !grpcPortChanged) return domia

	networkSyncLogger.info("Refreshing self domia row", {
		domiaId: domia?.id,
		ipChanged,
		grpcPortChanged,
		previousIp: domia?.localIp,
		currentIp,
		previousGrpcPort: domia?.grpcPort,
		currentGrpcPort,
	})

	const refreshed = {
		...domia,
		localIp: currentIp ?? domia?.localIp,
		grpcPort: currentGrpcPort,
	}
	dbAdapter.upsertDomia(normalizeDomia(refreshed)).run()
	return refreshed
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
		dbAdapter.deleteStalePeerByKey(domiaKey, domiaId, tx)
		dbAdapter
			.upsertDomia({ ...normalizeDomia(domia), lastSeenAt: Date.now() }, tx)
			.run()

		const runtimeCapabilities = normalizeRuntimeCapabilities(domia)
		if (runtimeCapabilities) {
			networkSyncLogger.debug(
				"Upserting runtime capabilities for Domia",
				logParams,
			)
			dbAdapter.upsertRuntimeCapabilities(runtimeCapabilities, tx).run()
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

	invalidateCapabilityCache()
}
