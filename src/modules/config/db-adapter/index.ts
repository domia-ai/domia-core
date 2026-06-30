import type { MqttSectionType } from "../types"
import { and, eq, sql, getTableColumns, type Table } from "drizzle-orm"
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
	skillProvider,
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

	bumpConfigRevision: (id: string, tx: DBClientOrTxType) =>
		tx
			.update(domia)
			.set({ configRevision: sql`${domia.configRevision} + 1` })
			.where(eq(domia.id, id)),

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

	replaceSkillProviders: (
		domiaId: string,
		items: (Omit<typeof skillProvider.$inferInsert, "id" | "domiaId"> & {
			id?: string
		})[],
		tx: DBClientOrTxType,
	): void => {
		const existing = tx
			.select()
			.from(skillProvider)
			.where(eq(skillProvider.domiaId, domiaId))
			.all()
		const byId = new Map(existing.map((row) => [row.id, row]))
		const byName = new Map(existing.map((row) => [row.name, row]))
		const keptIds = new Set<string>()
		for (const item of items) {
			const { id: incomingId, ...rest } = item
			const prev = (incomingId && byId.get(incomingId)) || byName.get(rest.name)
			if (prev) {
				keptIds.add(prev.id)
				tx.update(skillProvider)
					.set(stamp(skillProvider, { ...rest, isActive: true }))
					.where(eq(skillProvider.id, prev.id))
					.run()
			} else
				tx.insert(skillProvider)
					.values({ ...rest, id: generateUuid(), domiaId, isActive: true })
					.run()
		}
		for (const row of existing)
			if (!keptIds.has(row.id))
				tx.delete(skillProvider).where(eq(skillProvider.id, row.id)).run()
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
