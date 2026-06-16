import { env } from "@/config"

import dbAdapter from "../db-adapter"
import {
	type InsertDomiaType,
	type DBClientOrTxType,
	DEFAULT_MEMORY_WINDOW_TURNS,
	DEFAULT_MEMORY_MAX_AGE_MS,
	DEFAULT_MAX_CONCURRENT_VOICE_REPLIES,
	DEFAULT_MAX_QUEUED_VOICE_REPLIES,
	DEFAULT_VOICE_QUEUE_TIMEOUT_MS,
	DEFAULT_OWN_CONFIG_TTL_MS,
	DEFAULT_WARMUP_ON_BOOT,
	DEFAULT_GRPC_UNARY_DEADLINE_MS,
	DEFAULT_GRPC_STREAM_IDLE_TIMEOUT_MS,
	DEFAULT_GRPC_STREAM_DEADLINE_MS,
	DEFAULT_PEER_STALE_AFTER_MS,
} from "@/db"
import type { DomiaWithRawRelationsType, DomiaType } from "../types"

export const transformDomia = (
	domia: DomiaWithRawRelationsType | undefined,
): DomiaType | undefined => {
	if (!domia) return undefined

	const runtimeCapabilities = domia?.runtimeCapabilities || null
	const emotionState = domia?.emotionState || null
	const characterProfile = domia?.characterProfiles?.[0] || null
	const moduleSettings = domia?.moduleSettings?.[0] || null
	const wakeWordConfig = domia?.wakeWordConfigs?.[0] || null
	const sttConfig = domia?.sttConfigs?.[0] || null
	const llmModelConfig = domia?.llmModelConfigs?.[0] || null
	const ttsConfig = domia?.ttsConfigs?.[0] || null
	const audioPlaybackConfig = domia?.audioPlaybackConfigs?.[0] || null
	const skillProviders = domia?.skillProviders || null
	const localMqttConfig =
		domia?.mqttConfigs?.find((config) => config?.type === "LOCAL") || null
	const capabilityDelegations = domia?.capabilityDelegations || null

	return {
		id: domia?.id,
		name: domia?.name,
		domiaKey: domia?.domiaKey,
		isActive: domia?.isActive,
		sessionIdTimeoutMs: domia?.sessionIdTimeoutMs || 300_000,
		memoryWindowTurns: domia?.memoryWindowTurns ?? DEFAULT_MEMORY_WINDOW_TURNS,
		memoryMaxAgeMs: domia?.memoryMaxAgeMs ?? DEFAULT_MEMORY_MAX_AGE_MS,
		maxConcurrentVoiceReplies:
			domia?.maxConcurrentVoiceReplies ?? DEFAULT_MAX_CONCURRENT_VOICE_REPLIES,
		maxQueuedVoiceReplies:
			domia?.maxQueuedVoiceReplies ?? DEFAULT_MAX_QUEUED_VOICE_REPLIES,
		voiceQueueTimeoutMs:
			domia?.voiceQueueTimeoutMs ?? DEFAULT_VOICE_QUEUE_TIMEOUT_MS,
		ownConfigTtlMs: domia?.ownConfigTtlMs ?? DEFAULT_OWN_CONFIG_TTL_MS,
		warmupOnBoot: domia?.warmupOnBoot ?? DEFAULT_WARMUP_ON_BOOT,
		localIp: domia?.localIp,
		grpcPort: domia?.grpcPort,
		lastSeenAt: domia?.lastSeenAt ?? null,
		grpcUnaryDeadlineMs:
			domia?.grpcUnaryDeadlineMs ?? DEFAULT_GRPC_UNARY_DEADLINE_MS,
		grpcStreamIdleTimeoutMs:
			domia?.grpcStreamIdleTimeoutMs ?? DEFAULT_GRPC_STREAM_IDLE_TIMEOUT_MS,
		grpcStreamDeadlineMs:
			domia?.grpcStreamDeadlineMs ?? DEFAULT_GRPC_STREAM_DEADLINE_MS,
		peerStaleAfterMs: domia?.peerStaleAfterMs ?? DEFAULT_PEER_STALE_AFTER_MS,
		createdAt: domia?.createdAt,
		updatedAt: domia?.updatedAt,
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
