import { eq, and } from "drizzle-orm"

import { networkSyncLogger } from "@/utils"
import {
	domia,
	dbClient,
	moduleSettings,
	characterProfile,
	emotionState,
	emotionEvent,
	memoryFact,
	wakeWordConfig,
	sttConfig,
	llmModelConfig,
	ttsConfig,
	skillProvider,
	audioPlaybackConfig,
	mqttConfig,
	runtimeCapabilities,
	capabilityDelegation,
	satelliteConfig,
	interactionTrace,
	interactionSessionTrace,
	announcement,
	type InsertDomiaType,
	type DBClientOrTxType,
	type InsertModuleSettingsType,
	type InsertCharacterProfileType,
	type InsertEmotionStateType,
	type InsertWakeWordConfigType,
	type InsertSttConfigType,
	type InsertLlmModelConfigType,
	type InsertTtsConfigType,
	type InsertSkillProviderType,
	type InsertAudioPlaybackConfigType,
	type InsertMqttConfigType,
	type InsertRuntimeCapabilitiesType,
	type InsertCapabilityDelegationType,
	type InsertSatelliteConfigType,
	DEFAULT_TIMESTAMP,
} from "@/db"

const PEER_CHILD_TABLES = [
	runtimeCapabilities,
	moduleSettings,
	characterProfile,
	emotionState,
	wakeWordConfig,
	sttConfig,
	llmModelConfig,
	ttsConfig,
	skillProvider,
	audioPlaybackConfig,
	mqttConfig,
	capabilityDelegation,
	emotionEvent,
	memoryFact,
	announcement,
	satelliteConfig,
] as const

const dbAdapter = {
	deleteStalePeerByKey: (
		domiaKey: string,
		newId: string,
		client: DBClientOrTxType = dbClient,
	): InsertSatelliteConfigType[] => {
		const existing = client
			.select({ id: domia.id, isHosted: domia.isHosted })
			.from(domia)
			.where(eq(domia.domiaKey, domiaKey))
			.get()
		if (!existing || existing.id === newId) return []
		if (existing.isHosted) {
			networkSyncLogger.warn(
				"domiaKey conflict: a network peer shares a locally-hosted identity's key — keeping the local row",
				{ domiaKey, localId: existing.id, peerId: newId },
			)
			return []
		}
		const strandedSatellites = client
			.select()
			.from(satelliteConfig)
			.where(eq(satelliteConfig.domiaId, existing.id))
			.all()
		client
			.update(capabilityDelegation)
			.set({ delegateToDomiaId: null })
			.where(eq(capabilityDelegation.delegateToDomiaId, existing.id))
			.run()
		client
			.delete(interactionTrace)
			.where(eq(interactionTrace.domiaId, existing.id))
			.run()
		client
			.delete(interactionSessionTrace)
			.where(eq(interactionSessionTrace.domiaId, existing.id))
			.run()
		for (const table of PEER_CHILD_TABLES) {
			client.delete(table).where(eq(table.domiaId, existing.id)).run()
		}
		client.delete(domia).where(eq(domia.id, existing.id)).run()
		return strandedSatellites
	},
	restoreSatellites: (
		rows: InsertSatelliteConfigType[],
		domiaId: string,
		client: DBClientOrTxType = dbClient,
	): void => {
		for (const row of rows) {
			client
				.insert(satelliteConfig)
				.values({ ...row, domiaId })
				.run()
		}
	},
	markPeerOffline: (
		nodeId: string,
		client: DBClientOrTxType = dbClient,
	): number => {
		const res = client
			.update(domia)
			.set({ lastSeenAt: 0 })
			.where(and(eq(domia.peerNodeId, nodeId), eq(domia.isHosted, false)))
			.run()
		return res.changes ?? 0
	},
	upsertDomia: (data: InsertDomiaType, client: DBClientOrTxType = dbClient) =>
		client
			.insert(domia)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: domia.id,
				set: data,
				where: eq(domia.id, data.id),
			}),
	upsertRuntimeCapabilities: (
		data: InsertRuntimeCapabilitiesType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(runtimeCapabilities)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: runtimeCapabilities.id,
				set: data,
				where: eq(runtimeCapabilities.domiaId, data.domiaId),
			}),
	upsertModuleSettings: (
		data: InsertModuleSettingsType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(moduleSettings)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: moduleSettings.id,
				set: data,
				where: eq(moduleSettings.domiaId, data.domiaId),
			}),
	upsertCharacterProfile: (
		data: InsertCharacterProfileType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(characterProfile)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: characterProfile.id,
				set: data,
				where: eq(characterProfile.domiaId, data.domiaId),
			}),
	upsertEmotionState: (
		data: InsertEmotionStateType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(emotionState)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: emotionState.id,
				set: data,
				where: eq(emotionState.domiaId, data.domiaId),
			}),
	upsertWakeWordConfig: (
		data: InsertWakeWordConfigType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(wakeWordConfig)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: wakeWordConfig.id,
				set: data,
				where: eq(wakeWordConfig.domiaId, data.domiaId),
			}),
	upsertSttConfig: (
		data: InsertSttConfigType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(sttConfig)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: sttConfig.id,
				set: data,
				where: eq(sttConfig.domiaId, data.domiaId),
			}),
	upsertLlmModelConfig: (
		data: InsertLlmModelConfigType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(llmModelConfig)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: llmModelConfig.id,
				set: data,
				where: eq(llmModelConfig.domiaId, data.domiaId),
			}),
	upsertTtsConfig: (
		data: InsertTtsConfigType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(ttsConfig)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: ttsConfig.id,
				set: data,
				where: eq(ttsConfig.domiaId, data.domiaId),
			}),
	upsertSkillProvider: (
		data: InsertSkillProviderType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(skillProvider)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: skillProvider.id,
				set: data,
				where: eq(skillProvider.domiaId, data.domiaId),
			}),
	upsertAudioPlaybackConfig: (
		data: InsertAudioPlaybackConfigType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(audioPlaybackConfig)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: audioPlaybackConfig.id,
				set: data,
				where: eq(audioPlaybackConfig.domiaId, data.domiaId),
			}),
	upsertMqttConfig: (
		data: InsertMqttConfigType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(mqttConfig)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: mqttConfig.id,
				set: data,
				where: eq(mqttConfig.domiaId, data.domiaId),
			}),
	upsertCapabilityDelegation: (
		data: InsertCapabilityDelegationType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(capabilityDelegation)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: capabilityDelegation.id,
				set: data,
				where: eq(capabilityDelegation.domiaId, data.domiaId),
			}),
}

export default dbAdapter
