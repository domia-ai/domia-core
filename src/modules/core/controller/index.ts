import { env } from "@/config"
import { generateUuid, domiaError, CORE_ERRORS } from "@/utils"

import dbAdapter from "../db-adapter"
import {
	type InsertDomiaType,
	type DBClientOrTxType,
	type InsertSatelliteConfigType,
	type SelectSatelliteConfigType,
} from "@/db"
import type { DomiaWithRawRelationsType, DomiaType } from "../types"

const REDACTED = "__redacted__"

const redactSatellite = (s: SelectSatelliteConfigType) => ({
	...s,
	encryptionKey: s.encryptionKey ? REDACTED : null,
	livekitApiSecret: s.livekitApiSecret ? REDACTED : null,
})

export const transformDomia = (
	domia: DomiaWithRawRelationsType | undefined,
): DomiaType | undefined => {
	if (!domia) return undefined

	const runtimeCapabilities = domia.runtimeCapabilities ?? null
	const emotionState = domia.emotionState ?? null
	const characterProfile = domia.characterProfiles?.[0] ?? null
	const moduleSettings = domia.moduleSettings?.[0] ?? null
	const wakeWordConfig = domia.wakeWordConfigs?.[0] ?? null
	const sttConfig = domia.sttConfigs?.[0] ?? null
	const llmModelConfig = domia.llmModelConfigs?.[0] ?? null
	const ttsConfig = domia.ttsConfigs?.[0] ?? null
	const audioPlaybackConfig = domia.audioPlaybackConfigs?.[0] ?? null
	const skillProviders = domia.skillProviders ?? null
	const localMqttConfig = domia.mqttConfigs?.[0] ?? null
	const capabilityDelegations = domia.capabilityDelegations ?? null

	return {
		id: domia.id,
		name: domia.name,
		domiaKey: domia.domiaKey,
		isActive: domia.isActive,
		sessionIdTimeoutMs: domia.sessionIdTimeoutMs || 300_000,
		memoryWindowTurns: domia.memoryWindowTurns,
		memoryMaxAgeMs: domia.memoryMaxAgeMs,
		maxConcurrentVoiceReplies: domia.maxConcurrentVoiceReplies,
		maxQueuedVoiceReplies: domia.maxQueuedVoiceReplies,
		voiceQueueTimeoutMs: domia.voiceQueueTimeoutMs,
		ownConfigTtlMs: domia.ownConfigTtlMs,
		warmupOnBoot: domia.warmupOnBoot,
		isHosted: domia.isHosted,
		localIp: domia.localIp,
		grpcPort: domia.grpcPort,
		lastSeenAt: domia.lastSeenAt ?? null,
		peerNodeId: domia.peerNodeId ?? null,
		grpcUnaryDeadlineMs: domia.grpcUnaryDeadlineMs,
		grpcStreamIdleTimeoutMs: domia.grpcStreamIdleTimeoutMs,
		grpcStreamDeadlineMs: domia.grpcStreamDeadlineMs,
		peerStaleAfterMs: domia.peerStaleAfterMs,
		configRevision: domia.configRevision,
		configReloadDrainMs: domia.configReloadDrainMs,
		modelInstallAllowedHosts: domia.modelInstallAllowedHosts,
		heartbeatSignatureRequired: domia.heartbeatSignatureRequired,
		knowledgeMaxChars: domia.knowledgeMaxChars,
		benchTurns: domia.benchTurns,
		benchThresholds: domia.benchThresholds,
		meshSecretGraceMs: domia.meshSecretGraceMs,
		grpcTls: domia.grpcTls,
		createdAt: domia.createdAt,
		updatedAt: domia.updatedAt,
		runtimeCapabilities,
		emotionState,
		characterProfile,
		moduleSettings,
		wakeWordConfig,
		sttConfig,
		llmModelConfig,
		ttsConfig,
		skillProviders,
		audioPlaybackConfig,
		localMqttConfig,
		capabilityDelegations,
	}
}

export const transformDomias = (domias: DomiaWithRawRelationsType[]) =>
	domias.map((domia) => transformDomia(domia)).filter((domia) => !!domia)

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

export const getHostedDomias = async () =>
	transformDomias(await dbAdapter.getHostedDomias())

export const setDomiaHosted = (domiaKey: string, isHosted: boolean) =>
	dbAdapter.setDomiaHosted(domiaKey, isHosted)

export const retireDomia = (domiaKey: string) => dbAdapter.retireDomia(domiaKey)

export const reactivateDomia = (domiaKey: string) =>
	dbAdapter.reactivateDomia(domiaKey)

export const insertDomia = (data: InsertDomiaType, client?: DBClientOrTxType) =>
	dbAdapter.insertDomia(data, client)

const HOST_NODE_SINGLETON_ID = "singleton"

let cachedNodeId: string | null = null

export const getNodeId = async (): Promise<string> => {
	if (cachedNodeId) return cachedNodeId
	await dbAdapter.ensureHostNode(HOST_NODE_SINGLETON_ID, generateUuid())
	const row = await dbAdapter.getHostNode()
	if (!row) throw domiaError(CORE_ERRORS.HOST_NODE_MISSING)
	cachedNodeId = row.nodeId
	return row.nodeId
}

export const getSatellitesForDomia = (domiaId: string) =>
	dbAdapter.getSatellitesForDomia(domiaId)

export const getRedactedSatellitesForDomia = async (domiaId: string) =>
	(await dbAdapter.getSatellitesForDomia(domiaId)).map(redactSatellite)

export const getActiveSatellites = () => dbAdapter.getActiveSatellites()

export const upsertSatellite = (
	domiaId: string,
	data: Omit<InsertSatelliteConfigType, "domiaId">,
) => dbAdapter.upsertSatellite(domiaId, data)

export const deleteSatellite = (domiaId: string, satelliteId: string) =>
	dbAdapter.deleteSatellite(domiaId, satelliteId)

export const setSatelliteDesiredWakeWords = (
	domiaId: string,
	satelliteId: string,
	desiredWakeWords: string[],
) =>
	dbAdapter.setSatelliteDesiredWakeWords(domiaId, satelliteId, desiredWakeWords)

export const setSatelliteDesiredNumber = (
	domiaId: string,
	satelliteId: string,
	entityId: string,
	value: number,
) => dbAdapter.setSatelliteDesiredNumber(domiaId, satelliteId, entityId, value)

export const setSatelliteFollowUp = (
	domiaId: string,
	satelliteId: string,
	followUpEnabled: boolean,
) => dbAdapter.setSatelliteFollowUp(domiaId, satelliteId, followUpEnabled)

export const setSatelliteDesiredVolume = (
	domiaId: string,
	satelliteId: string,
	desiredVolume: number,
) => dbAdapter.setSatelliteDesiredVolume(domiaId, satelliteId, desiredVolume)
