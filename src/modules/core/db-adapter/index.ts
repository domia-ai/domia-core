import { and, eq } from "drizzle-orm"

import { env } from "@/config"
import {
	dbClient,
	domia,
	hostNode,
	satelliteConfig,
	type DBClientOrTxType,
	type InsertDomiaType,
	type InsertSatelliteConfigType,
} from "@/db"

const dbAdapter = {
	getDomiaByDomiaKey: (
		domiaKey: string = env.DOMIA_KEY,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.domia.findFirst({
			where: eq(domia.domiaKey, domiaKey),
			with: {
				runtimeCapabilities: true,
				emotionState: true,
				moduleSettings: {
					limit: 1,
					where: (moduleSettings, { eq }) => eq(moduleSettings.isActive, true),
				},
				characterProfiles: {
					limit: 1,
					where: (characterProfile, { eq }) =>
						eq(characterProfile.isActive, true),
				},
				wakeWordConfigs: {
					limit: 1,
					where: (wakeWordConfig, { eq }) => eq(wakeWordConfig.isActive, true),
				},
				sttConfigs: {
					limit: 1,
					where: (sttConfig, { eq }) => eq(sttConfig.isActive, true),
				},
				llmModelConfigs: {
					limit: 1,
					where: (llmModelConfig, { eq }) => eq(llmModelConfig.isActive, true),
				},
				ttsConfigs: {
					limit: 1,
					where: (ttsConfig, { eq }) => eq(ttsConfig.isActive, true),
				},
				audioPlaybackConfigs: {
					limit: 1,
					where: (audioPlaybackConfigs, { eq }) =>
						eq(audioPlaybackConfigs.isActive, true),
				},
				skillProviders: {
					where: (skillProvider, { eq }) => eq(skillProvider.isActive, true),
				},
				mqttConfigs: {
					where: (mqttConfig, { eq }) => eq(mqttConfig.isActive, true),
				},
				capabilityDelegations: {
					where: (capabilityDelegation, { eq }) =>
						eq(capabilityDelegation.isActive, true),
				},
			},
		}),
	getDomiaById: (id: string, client: DBClientOrTxType = dbClient) =>
		client.query.domia.findFirst({
			where: eq(domia.id, id),
			with: {
				runtimeCapabilities: true,
				emotionState: true,
				moduleSettings: {
					limit: 1,
					where: (moduleSettings, { eq }) => eq(moduleSettings.isActive, true),
				},
				characterProfiles: {
					limit: 1,
					where: (characterProfile, { eq }) =>
						eq(characterProfile.isActive, true),
				},
				wakeWordConfigs: {
					limit: 1,
					where: (wakeWordConfig, { eq }) => eq(wakeWordConfig.isActive, true),
				},
				sttConfigs: {
					limit: 1,
					where: (sttConfig, { eq }) => eq(sttConfig.isActive, true),
				},
				llmModelConfigs: {
					limit: 1,
					where: (llmModelConfig, { eq }) => eq(llmModelConfig.isActive, true),
				},
				ttsConfigs: {
					limit: 1,
					where: (ttsConfig, { eq }) => eq(ttsConfig.isActive, true),
				},
				audioPlaybackConfigs: {
					limit: 1,
					where: (audioPlaybackConfigs, { eq }) =>
						eq(audioPlaybackConfigs.isActive, true),
				},
				skillProviders: {
					where: (skillProvider, { eq }) => eq(skillProvider.isActive, true),
				},
				mqttConfigs: {
					where: (mqttConfig, { eq }) => eq(mqttConfig.isActive, true),
				},
				capabilityDelegations: {
					where: (capabilityDelegation, { eq }) =>
						eq(capabilityDelegation.isActive, true),
				},
			},
		}),
	getActiveDomias: (client: DBClientOrTxType = dbClient) =>
		client.query.domia.findMany({
			where: eq(domia.isActive, true),
			with: {
				runtimeCapabilities: true,
				emotionState: true,
				moduleSettings: {
					limit: 1,
					where: (moduleSettings, { eq }) => eq(moduleSettings.isActive, true),
				},
				characterProfiles: {
					limit: 1,
					where: (characterProfile, { eq }) =>
						eq(characterProfile.isActive, true),
				},
				wakeWordConfigs: {
					limit: 1,
					where: (wakeWordConfig, { eq }) => eq(wakeWordConfig.isActive, true),
				},
				sttConfigs: {
					limit: 1,
					where: (sttConfig, { eq }) => eq(sttConfig.isActive, true),
				},
				llmModelConfigs: {
					limit: 1,
					where: (llmModelConfig, { eq }) => eq(llmModelConfig.isActive, true),
				},
				ttsConfigs: {
					limit: 1,
					where: (ttsConfig, { eq }) => eq(ttsConfig.isActive, true),
				},
				audioPlaybackConfigs: {
					limit: 1,
					where: (audioPlaybackConfigs, { eq }) =>
						eq(audioPlaybackConfigs.isActive, true),
				},
				skillProviders: {
					where: (skillProvider, { eq }) => eq(skillProvider.isActive, true),
				},
				mqttConfigs: {
					where: (mqttConfig, { eq }) => eq(mqttConfig.isActive, true),
				},
				capabilityDelegations: {
					where: (capabilityDelegation, { eq }) =>
						eq(capabilityDelegation.isActive, true),
				},
			},
		}),
	getHostedDomias: (client: DBClientOrTxType = dbClient) =>
		client.query.domia.findMany({
			where: and(eq(domia.isActive, true), eq(domia.isHosted, true)),
			with: {
				runtimeCapabilities: true,
				emotionState: true,
				moduleSettings: {
					limit: 1,
					where: (moduleSettings, { eq }) => eq(moduleSettings.isActive, true),
				},
				characterProfiles: {
					limit: 1,
					where: (characterProfile, { eq }) =>
						eq(characterProfile.isActive, true),
				},
				wakeWordConfigs: {
					limit: 1,
					where: (wakeWordConfig, { eq }) => eq(wakeWordConfig.isActive, true),
				},
				sttConfigs: {
					limit: 1,
					where: (sttConfig, { eq }) => eq(sttConfig.isActive, true),
				},
				llmModelConfigs: {
					limit: 1,
					where: (llmModelConfig, { eq }) => eq(llmModelConfig.isActive, true),
				},
				ttsConfigs: {
					limit: 1,
					where: (ttsConfig, { eq }) => eq(ttsConfig.isActive, true),
				},
				audioPlaybackConfigs: {
					limit: 1,
					where: (audioPlaybackConfigs, { eq }) =>
						eq(audioPlaybackConfigs.isActive, true),
				},
				skillProviders: {
					where: (skillProvider, { eq }) => eq(skillProvider.isActive, true),
				},
				mqttConfigs: {
					where: (mqttConfig, { eq }) => eq(mqttConfig.isActive, true),
				},
				capabilityDelegations: {
					where: (capabilityDelegation, { eq }) =>
						eq(capabilityDelegation.isActive, true),
				},
			},
		}),
	setDomiaHosted: (
		domiaKey: string,
		isHosted: boolean,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(domia)
			.set({ isHosted })
			.where(eq(domia.domiaKey, domiaKey))
			.returning(),
	retireDomia: (domiaKey: string, client: DBClientOrTxType = dbClient) =>
		client
			.update(domia)
			.set({ isHosted: false, isActive: false })
			.where(eq(domia.domiaKey, domiaKey))
			.returning(),
	reactivateDomia: (domiaKey: string, client: DBClientOrTxType = dbClient) =>
		client
			.update(domia)
			.set({ isHosted: true, isActive: true })
			.where(eq(domia.domiaKey, domiaKey))
			.returning(),
	insertDomia: (data: InsertDomiaType, client: DBClientOrTxType = dbClient) =>
		client.insert(domia).values(data).returning(),
	getHostNode: (client: DBClientOrTxType = dbClient) =>
		client.query.hostNode.findFirst(),
	ensureHostNode: (
		id: string,
		nodeId: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(hostNode)
			.values({ id, nodeId })
			.onConflictDoNothing({ target: hostNode.id }),
	getSatellitesForDomia: (
		domiaId: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.satelliteConfig.findMany({
			where: eq(satelliteConfig.domiaId, domiaId),
		}),
	getActiveSatellites: (client: DBClientOrTxType = dbClient) =>
		client.query.satelliteConfig.findMany({
			where: eq(satelliteConfig.isActive, true),
			with: { domia: true },
		}),
	upsertSatellite: (
		domiaId: string,
		data: Omit<InsertSatelliteConfigType, "domiaId">,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(satelliteConfig)
			.values({ ...data, domiaId })
			.onConflictDoUpdate({
				target: [satelliteConfig.domiaId, satelliteConfig.satelliteId],
				set: {
					name: data.name,
					host: data.host,
					port: data.port,
					encryptionKey: data.encryptionKey,
					protocol: data.protocol,
					...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
					updatedAt: new Date().toISOString(),
				},
			})
			.returning(),
	deleteSatellite: (
		domiaId: string,
		satelliteId: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.delete(satelliteConfig)
			.where(
				and(
					eq(satelliteConfig.domiaId, domiaId),
					eq(satelliteConfig.satelliteId, satelliteId),
				),
			)
			.returning(),
	setSatelliteDesiredWakeWords: (
		domiaId: string,
		satelliteId: string,
		desiredWakeWords: string[],
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(satelliteConfig)
			.set({ desiredWakeWords, updatedAt: new Date().toISOString() })
			.where(
				and(
					eq(satelliteConfig.domiaId, domiaId),
					eq(satelliteConfig.satelliteId, satelliteId),
				),
			)
			.returning(),
	setSatelliteDesiredNumber: async (
		domiaId: string,
		satelliteId: string,
		entityId: string,
		value: number,
		client: DBClientOrTxType = dbClient,
	) => {
		const row = await client.query.satelliteConfig.findFirst({
			where: and(
				eq(satelliteConfig.domiaId, domiaId),
				eq(satelliteConfig.satelliteId, satelliteId),
			),
		})
		if (!row) return []
		const desiredNumbers = { ...(row.desiredNumbers ?? {}), [entityId]: value }
		return client
			.update(satelliteConfig)
			.set({ desiredNumbers, updatedAt: new Date().toISOString() })
			.where(
				and(
					eq(satelliteConfig.domiaId, domiaId),
					eq(satelliteConfig.satelliteId, satelliteId),
				),
			)
			.returning()
	},
	setSatelliteFollowUp: (
		domiaId: string,
		satelliteId: string,
		followUpEnabled: boolean,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(satelliteConfig)
			.set({ followUpEnabled, updatedAt: new Date().toISOString() })
			.where(
				and(
					eq(satelliteConfig.domiaId, domiaId),
					eq(satelliteConfig.satelliteId, satelliteId),
				),
			)
			.returning(),
}

export default dbAdapter
