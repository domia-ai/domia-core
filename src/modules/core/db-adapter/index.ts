import { eq } from "drizzle-orm"

import { env } from "@/config"
import {
	dbClient,
	domia,
	type DBClientOrTxType,
	type InsertDomiaType,
} from "@/db"

const dbAdapter = {
	getDomiaByDomiaKey: (
		domiaKey: string = env.DOMIA_KEY,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.domia.findFirst({
			where: eq(domia.domiaKey, domiaKey),
			with: {
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
				mcpServerConfigs: {
					where: (mcpServerConfig, { eq }) =>
						eq(mcpServerConfig.isActive, true),
				},
			},
		}),
	getDomiaById: (id: string, client: DBClientOrTxType = dbClient) =>
		client.query.domia.findFirst({
			where: eq(domia.id, id),
			with: {
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
				mcpServerConfigs: {
					where: (mcpServerConfig, { eq }) =>
						eq(mcpServerConfig.isActive, true),
				},
			},
		}),
	getActiveDomias: (client: DBClientOrTxType = dbClient) =>
		client.query.domia.findMany({
			where: eq(domia.isActive, true),
			with: {
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
				mcpServerConfigs: {
					where: (mcpServerConfig, { eq }) =>
						eq(mcpServerConfig.isActive, true),
				},
			},
		}),
	insertDomia: (data: InsertDomiaType, client: DBClientOrTxType = dbClient) =>
		client.insert(domia).values(data).returning(),
}

export default dbAdapter
