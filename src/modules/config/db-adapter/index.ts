import type { MqttSectionType } from "../types"
import { and, eq, getTableColumns, type Table } from "drizzle-orm"
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

const stamp = <T extends Record<string, unknown>>(table: Table, fields: T) => {
	const columns = getTableColumns(table) as Record<
		string,
		{ notNull?: boolean }
	>
	const cleaned: Partial<T> = {}
	for (const key of Object.keys(fields) as (keyof T)[]) {
		const value = fields[key]
		if (value === undefined) continue
		const isEmpty = value === null || value === ""
		if (isEmpty && columns[key as string]?.notNull === true) continue
		cleaned[key] = value
	}
	return { ...cleaned, updatedAt: DEFAULT_TIMESTAMP }
}

const dbAdapter = {
	materializeDomia: (
		id: string,
		fields: Partial<typeof domia.$inferInsert>,
		tx: DBClientOrTxType,
	) => tx.update(domia).set(stamp(domia, fields)).where(eq(domia.id, id)),

	materializeCapabilities: (
		domiaId: string,
		fields: Partial<typeof runtimeCapabilities.$inferInsert>,
		tx: DBClientOrTxType,
	) =>
		tx
			.update(runtimeCapabilities)
			.set(stamp(runtimeCapabilities, fields))
			.where(eq(runtimeCapabilities.domiaId, domiaId)),

	materializeEmotion: (
		domiaId: string,
		fields: Partial<typeof emotionState.$inferInsert>,
		tx: DBClientOrTxType,
	) =>
		tx
			.update(emotionState)
			.set(stamp(emotionState, fields))
			.where(eq(emotionState.domiaId, domiaId)),

	materializeCharacter: (
		domiaId: string,
		fields: Partial<typeof characterProfile.$inferInsert>,
		tx: DBClientOrTxType,
	) =>
		tx
			.update(characterProfile)
			.set(stamp(characterProfile, fields))
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
			.set(stamp(moduleSettings, fields))
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
			.set(stamp(sttConfig, fields))
			.where(and(eq(sttConfig.domiaId, domiaId), eq(sttConfig.isActive, true))),

	materializeTts: (
		domiaId: string,
		fields: Partial<typeof ttsConfig.$inferInsert>,
		tx: DBClientOrTxType,
	) =>
		tx
			.update(ttsConfig)
			.set(stamp(ttsConfig, fields))
			.where(and(eq(ttsConfig.domiaId, domiaId), eq(ttsConfig.isActive, true))),

	materializeLlm: (
		domiaId: string,
		fields: Partial<typeof llmModelConfig.$inferInsert>,
		tx: DBClientOrTxType,
	) =>
		tx
			.update(llmModelConfig)
			.set(stamp(llmModelConfig, fields))
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
			.set(stamp(wakeWordConfig, fields))
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
			.set(stamp(audioPlaybackConfig, fields))
			.where(
				and(
					eq(audioPlaybackConfig.domiaId, domiaId),
					eq(audioPlaybackConfig.isActive, true),
				),
			),

	materializeMqtt: (
		domiaId: string,
		type: MqttSectionType,
		fields: Partial<typeof mqttConfig.$inferInsert>,
		tx: DBClientOrTxType,
	): void => {
		const updated = tx
			.update(mqttConfig)
			.set(stamp(mqttConfig, fields))
			.where(and(eq(mqttConfig.domiaId, domiaId), eq(mqttConfig.type, type)))
			.run()
		if (updated.changes === 0)
			tx.insert(mqttConfig)
				.values({
					...fields,
					id: generateUuid(),
					domiaId,
					type,
					name: fields.name ?? `${type.toLowerCase()}-broker`,
				} as typeof mqttConfig.$inferInsert)
				.run()
	},

	replaceMcpServers: (
		domiaId: string,
		items: Omit<typeof mcpServerConfig.$inferInsert, "id" | "domiaId">[],
		tx: DBClientOrTxType,
	): void => {
		tx.delete(mcpServerConfig).where(eq(mcpServerConfig.domiaId, domiaId)).run()
		if (items.length)
			tx.insert(mcpServerConfig)
				.values(
					items.map((i) => ({
						...i,
						id: generateUuid(),
						domiaId,
						isActive: true,
					})),
				)
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
