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
	normalizeSkillProviders,
	normalizeSttConfig,
	normalizeTtsConfig,
} from "../utils"

const VIRTUAL_IFACE =
	/^(utun|tun|tap|ppp|bridge|vmnet|vnic|llw|awdl|gif|stf|ipsec|docker|veth|wg)/i

const isPrivateIpv4 = (ip: string): boolean =>
	/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)

export const getLocalIp = (): string | null => {
	const candidates: { name: string; address: string }[] = []
	for (const [name, iface] of Object.entries(os.networkInterfaces())) {
		for (const config of iface ?? []) {
			if (config.family === "IPv4" && !config.internal)
				candidates.push({ name, address: config.address })
		}
	}
	if (candidates.length === 0) return null
	const physical = candidates.filter((c) => !VIRTUAL_IFACE.test(c.name))
	const pool = physical.length > 0 ? physical : candidates
	const privateLan = pool.find((c) => isPrivateIpv4(c.address))
	return (privateLan ?? pool[0]).address
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

export const markPeerOfflineByNodeId = (nodeId: string): number => {
	const changed = dbAdapter.markPeerOffline(nodeId)
	if (changed > 0) {
		networkSyncLogger.info(
			`⚰️ peer node ${nodeId} offline (LWT) — ${changed} identity row(s) marked stale`,
		)
	}
	return changed
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
		const strandedSatellites = dbAdapter.deleteStalePeerByKey(
			domiaKey,
			domiaId,
			tx,
		)
		dbAdapter
			.upsertDomia(
				{ ...normalizeDomia(domia), isHosted: false, lastSeenAt: Date.now() },
				tx,
			)
			.run()
		if (strandedSatellites.length > 0) {
			networkSyncLogger.info(
				`🛰️ re-parented ${strandedSatellites.length} satellite binding(s) across peer re-registration`,
				logParams,
			)
			dbAdapter.restoreSatellites(strandedSatellites, domiaId, tx)
		}

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

		const skillProviders = normalizeSkillProviders(domia)
		if (skillProviders) {
			networkSyncLogger.debug(
				"Upserting MCP server configs for Domia",
				logParams,
			)

			for (const skillProvider of skillProviders) {
				dbAdapter.upsertSkillProvider(skillProvider, tx).run()
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
