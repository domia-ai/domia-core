import { env } from "@/config"

import dbAdapter from "../db-adapter"
import type { InsertDomiaType, DBClientOrTxType } from "@/db"
import type { DomiaWithRawRelationsType, DomiaType } from "../types"

export const transformDomia = (
	domia: DomiaWithRawRelationsType | undefined,
): DomiaType | undefined => {
	if (!domia) return undefined

	const emotionState = domia?.emotionState || null
	const characterProfile = domia?.characterProfiles?.[0] || null
	const moduleSettings = domia?.moduleSettings?.[0] || null
	const wakeWordConfig = domia?.wakeWordConfigs?.[0] || null
	const sttConfig = domia?.sttConfigs?.[0] || null
	const llmModelConfig = domia?.llmModelConfigs?.[0] || null
	const ttsConfig = domia?.ttsConfigs?.[0] || null
	const audioPlaybackConfig = domia?.audioPlaybackConfigs?.[0] || null
	const mcpServerConfigs = domia?.mcpServerConfigs || null

	return {
		id: domia?.id,
		name: domia?.name,
		domiaKey: domia?.domiaKey,
		isActive: domia?.isActive,
		sessionIdTimeoutMs: domia?.sessionIdTimeoutMs || 300_000,
		createdAt: domia?.createdAt,
		updatedAt: domia?.updatedAt,
		emotionState,
		characterProfile,
		moduleSettings,
		wakeWordConfig,
		sttConfig,
		llmModelConfig,
		ttsConfig,
		mcpServerConfigs,
		audioPlaybackConfig,
	}
}

export const transformDomias = (domias: DomiaWithRawRelationsType[]) =>
	domias?.map((domia) => transformDomia(domia))?.filter((domia) => !!domia)

export const getDomiaByDomiaKey = async (domiaKey: string) =>
	transformDomia(await dbAdapter.getDomiaByDomiaKey(domiaKey))

export const getDomiaById = async (id: string) =>
	transformDomia(await dbAdapter.getDomiaById(id))

export const getDomia = async (
	domiaIdOrKey: string = env.DOMIA_KEY,
	byKey = true,
) =>
	transformDomia(
		await (byKey
			? dbAdapter.getDomiaByDomiaKey(domiaIdOrKey)
			: dbAdapter.getDomiaById(domiaIdOrKey)),
	)

export const getActiveDomias = async () =>
	transformDomias(await dbAdapter.getActiveDomias())

export const insertDomia = (data: InsertDomiaType, client?: DBClientOrTxType) =>
	dbAdapter.insertDomia(data, client)
