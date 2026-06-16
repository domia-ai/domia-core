import { eq } from "drizzle-orm"

import {
	dbClient,
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
	runtimeCapabilities,
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
	type UpdateModuleSettingsType,
	type InsertRuntimeCapabilitiesType,
	DEFAULT_TIMESTAMP,
} from "@/db"

const dbAdapter = {
	insertRuntimeCapabilities: (
		data: InsertRuntimeCapabilitiesType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(runtimeCapabilities).values(data),
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
				where: eq(characterProfile.domiaId, data.domiaId),
			}),
	insertModuleSettings: (
		data: InsertModuleSettingsType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(moduleSettings).values(data),
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
				where: eq(characterProfile.domiaId, data.domiaId),
			}),
	insertCharacterProfile: (
		data: InsertCharacterProfileType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(characterProfile).values(data),
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
	updateModuleSettingsByDomiaId: (
		domiaId: string,
		data: UpdateModuleSettingsType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(moduleSettings)
			.set({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.where(eq(moduleSettings.domiaId, domiaId)),
	insertEmotionState: (
		data: InsertEmotionStateType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(emotionState).values(data),
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
	insertWakeWordConfig: (
		data: InsertWakeWordConfigType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(wakeWordConfig).values(data),
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
	insertSttConfig: (
		data: InsertSttConfigType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(sttConfig).values(data),
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
	insertLlmModelConfig: (
		data: InsertLlmModelConfigType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(llmModelConfig).values(data),
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
	insertTtsConfig: (
		data: InsertTtsConfigType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(ttsConfig).values(data),
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
	insertSkillProvider: (
		data: InsertSkillProviderType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(skillProvider).values(data),
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
	insertAudioPlaybackConfig: (
		data: InsertAudioPlaybackConfigType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(audioPlaybackConfig).values(data),
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
				where: eq(characterProfile.domiaId, data.domiaId),
			}),
	insertMqttConfig: (
		data: InsertMqttConfigType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(mqttConfig).values(data),
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
				where: eq(characterProfile.domiaId, data.domiaId),
			}),
}

export default dbAdapter
