import { and, eq } from "drizzle-orm"
import {
	domia,
	runtimeCapabilities,
	emotionState,
	moduleSettings,
	characterProfile,
	wakeWordConfig,
	sttConfig,
	llmModelConfig,
	ttsConfig,
	audioPlaybackConfig,
	mqttConfig,
	mcpServerConfig,
	capabilityDelegation,
	type DBClientOrTxType,
	DEFAULT_TIMESTAMP,
} from "@/db"
import { generateUuid } from "@/utils"

type MqttType = (typeof mqttConfig.$inferSelect)["type"]

const stamp = <T extends object>(fields: T) => ({
	...fields,
	updatedAt: DEFAULT_TIMESTAMP,
})

const dbAdapter = {
	materializeDomia: (
		id: string,
		fields: Partial<typeof domia.$inferInsert>,
		tx: DBClientOrTxType,
	) => tx.update(domia).set(stamp(fields)).where(eq(domia.id, id)),

	materializeCapabilities: (
		domiaId: string,
		fields: Partial<typeof runtimeCapabilities.$inferInsert>,
		tx: DBClientOrTxType,
	) =>
		tx
			.update(runtimeCapabilities)
			.set(stamp(fields))
			.where(eq(runtimeCapabilities.domiaId, domiaId)),

	materializeEmotion: (
		domiaId: string,
		fields: Partial<typeof emotionState.$inferInsert>,
		tx: DBClientOrTxType,
	) =>
		tx
			.update(emotionState)
			.set(stamp(fields))
			.where(eq(emotionState.domiaId, domiaId)),

	materializeCharacter: (
		domiaId: string,
		fields: Partial<typeof characterProfile.$inferInsert>,
		tx: DBClientOrTxType,
	) =>
		tx
			.update(characterProfile)
			.set(stamp(fields))
			.where(
				and(
					eq(characterProfile.domiaId, domiaId),
					eq(characterProfile.isActive, true),
				),
			),

	materializeModules: (
		domiaId: string,
		fields: Partial<typeof moduleSettings.$inferInsert>,
		tx: DBClientOrTxType,
	) =>
		tx
			.update(moduleSettings)
			.set(stamp(fields))
			.where(
				and(
					eq(moduleSettings.domiaId, domiaId),
					eq(moduleSettings.isActive, true),
				),
			),

	materializeStt: (
		domiaId: string,
		fields: Partial<typeof sttConfig.$inferInsert>,
		tx: DBClientOrTxType,
	) =>
		tx
			.update(sttConfig)
			.set(stamp(fields))
			.where(and(eq(sttConfig.domiaId, domiaId), eq(sttConfig.isActive, true))),

	materializeTts: (
		domiaId: string,
		fields: Partial<typeof ttsConfig.$inferInsert>,
		tx: DBClientOrTxType,
	) =>
		tx
			.update(ttsConfig)
			.set(stamp(fields))
			.where(and(eq(ttsConfig.domiaId, domiaId), eq(ttsConfig.isActive, true))),

	materializeLlm: (
		domiaId: string,
		fields: Partial<typeof llmModelConfig.$inferInsert>,
		tx: DBClientOrTxType,
	) =>
		tx
			.update(llmModelConfig)
			.set(stamp(fields))
			.where(
				and(
					eq(llmModelConfig.domiaId, domiaId),
					eq(llmModelConfig.isActive, true),
				),
			),

	materializeWakeWord: (
		domiaId: string,
		fields: Partial<typeof wakeWordConfig.$inferInsert>,
		tx: DBClientOrTxType,
	) =>
		tx
			.update(wakeWordConfig)
			.set(stamp(fields))
			.where(
				and(
					eq(wakeWordConfig.domiaId, domiaId),
					eq(wakeWordConfig.isActive, true),
				),
			),

	materializePlayback: (
		domiaId: string,
		fields: Partial<typeof audioPlaybackConfig.$inferInsert>,
		tx: DBClientOrTxType,
	) =>
		tx
			.update(audioPlaybackConfig)
			.set(stamp(fields))
			.where(
				and(
					eq(audioPlaybackConfig.domiaId, domiaId),
					eq(audioPlaybackConfig.isActive, true),
				),
			),

	materializeMqtt: (
		domiaId: string,
		type: MqttType,
		fields: Partial<typeof mqttConfig.$inferInsert>,
		tx: DBClientOrTxType,
	) =>
		tx
			.update(mqttConfig)
			.set(stamp(fields))
			.where(and(eq(mqttConfig.domiaId, domiaId), eq(mqttConfig.type, type))),

	replaceMcpServers: (
		domiaId: string,
		items: Omit<typeof mcpServerConfig.$inferInsert, "id" | "domiaId">[],
		tx: DBClientOrTxType,
	): void => {
		tx.delete(mcpServerConfig).where(eq(mcpServerConfig.domiaId, domiaId)).run()
		if (items.length)
			tx.insert(mcpServerConfig)
				.values(items.map((i) => ({ ...i, id: generateUuid(), domiaId })))
				.run()
	},

	replaceDelegations: (
		domiaId: string,
		items: Omit<typeof capabilityDelegation.$inferInsert, "id" | "domiaId">[],
		tx: DBClientOrTxType,
	): void => {
		tx.delete(capabilityDelegation)
			.where(eq(capabilityDelegation.domiaId, domiaId))
			.run()
		if (items.length)
			tx.insert(capabilityDelegation)
				.values(items.map((i) => ({ ...i, id: generateUuid(), domiaId })))
				.run()
	},
}

export default dbAdapter
