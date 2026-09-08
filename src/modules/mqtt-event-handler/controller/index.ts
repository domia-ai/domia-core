import type {
	DispatchMeshEventArgsType,
	WarnDropArgsType,
	handleMqttMessageArgsType,
} from "../types"
import {
	MESH_CONTROL_ENVELOPE_FIELDS,
	MESH_DROP_WARN_WINDOW_MS,
	MESH_IDENTITY_FIELD_BY_EVENT,
	SIGNATURE_POLICY_REJECT_REASONS,
} from "../constants"
import { MQTT_EVENT_ENUM } from "@/setups/mqtt/constants"
import { DEFAULT_HEARTBEAT_SIGNATURE_REQUIRED } from "@/db"
import {
	type LoggerType,
	type MeshControlRejectReasonType,
	type MeshDropWarnSummaryType,
	createMeshDropWarnThrottle,
	createMeshReplayGuard,
	verifyMeshControlEnvelope,
	setMeshAuthTunables,
} from "@/utils"
import {
	type DomiaType,
	invalidateOwnDomia,
	getOwnDomia,
	getNodeId,
} from "@/modules/core"
import { setPeerSpeaking, clearPeerSpeech } from "@/modules/core-bus"
import { setGrpcClientTunables } from "@/modules/grpc-client"
import { receiveHeartbeat } from "@/modules/heartbeat-manager"
import { markPeerOfflineByNodeId } from "@/modules/network-sync"

export const isMqttEvent = (value: string): value is MQTT_EVENT_ENUM => {
	return Object.values(MQTT_EVENT_ENUM).includes(value as MQTT_EVENT_ENUM)
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
	typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null

const meshGuard = createMeshReplayGuard()

const dropWarns = createMeshDropWarnThrottle({
	windowMs: MESH_DROP_WARN_WINDOW_MS,
})

const summaryLine = (summary: MeshDropWarnSummaryType): string =>
	`⚠️ ${summary.label} dropped — ${summary.reason} ×${summary.suppressed} more in the last ${Math.round(summary.windowMs / 1_000)}s`

const flushDropWarns = (logger: LoggerType): void => {
	for (const summary of dropWarns.sweep()) logger.warn(summaryLine(summary))
}

const warnDrop = ({
	identity,
	reason,
	label,
	text,
	logger,
}: WarnDropArgsType): void => {
	const { emit, summary } = dropWarns.record({ identity, reason, label })
	if (summary) logger.warn(summaryLine(summary))
	if (emit) logger.warn(text)
}

const stripEnvelope = (
	payload: Record<string, unknown>,
): Record<string, unknown> =>
	Object.fromEntries(
		Object.entries(payload).filter(
			([key]) => !MESH_CONTROL_ENVELOPE_FIELDS.has(key),
		),
	)

const signaturePolicyAllows = async (
	ownDomiaKey: string,
	logger: LoggerType,
): Promise<boolean> => {
	const own = await getOwnDomia(ownDomiaKey).catch((err: unknown) => {
		logger.warn("own identity lookup failed — default signature policy", {
			err,
			ownDomiaKey,
		})
		return undefined
	})
	return !(
		own?.heartbeatSignatureRequired ?? DEFAULT_HEARTBEAT_SIGNATURE_REQUIRED
	)
}

const dispatchMeshEvent = ({
	eventName,
	payload,
	topicIdentity,
	mqttType,
	logger,
}: DispatchMeshEventArgsType): void => {
	switch (eventName) {
		case MQTT_EVENT_ENUM.HEARTBEAT: {
			logger.info(`💓 heartbeat from ${topicIdentity} [${mqttType}]`)
			void receiveHeartbeat({
				domia: stripEnvelope(payload) as DomiaType,
			}).catch((err: unknown) =>
				logger.error(`❌ heartbeat upsert failed for ${topicIdentity}`, {
					err,
				}),
			)
			break
		}
		case MQTT_EVENT_ENUM.CONFIG_CHANGED: {
			invalidateOwnDomia(topicIdentity)
			void getOwnDomia(topicIdentity)
				.then((fresh) => {
					if (!fresh) return
					setGrpcClientTunables(fresh)
					setMeshAuthTunables(fresh)
				})
				.catch((err: unknown) =>
					logger.warn(`grpc tunables refresh failed for ${topicIdentity}`, {
						err,
					}),
				)
			logger.info(`🔄 config cache invalidated via MQTT [${topicIdentity}]`)
			break
		}
		case MQTT_EVENT_ENUM.OFFLINE: {
			markPeerOfflineByNodeId(topicIdentity)
			clearPeerSpeech(topicIdentity)
			meshGuard.forget(topicIdentity)
			break
		}
		case MQTT_EVENT_ENUM.SPEAKING: {
			const peerDomiaKey =
				typeof payload.domiaKey === "string" ? payload.domiaKey : ""
			const speaking = payload.speaking
			if (typeof speaking !== "boolean") {
				logger.warn(`⚠️ malformed speaking payload from ${topicIdentity}`)
				break
			}
			void getNodeId()
				.then((own) => {
					if (topicIdentity !== own)
						setPeerSpeaking(topicIdentity, peerDomiaKey, speaking)
				})
				.catch(() => setPeerSpeaking(topicIdentity, peerDomiaKey, speaking))
			break
		}
		default: {
			const unhandled: never = eventName
			logger.warn("⚠️ unhandled MQTT event", { eventName: unhandled })
		}
	}
}

export const handleMqttMessage = ({
	topic,
	message,
	logger,
	domia,
}: handleMqttMessageArgsType) => {
	const parts = topic.split("/")
	const [, topicIdentity, mqttType, eventName] = parts

	if (!topicIdentity || !eventName) return
	if (!isMqttEvent(eventName)) return

	try {
		flushDropWarns(logger)
		const payload = asRecord(JSON.parse(message.toString()))
		const verdict = verifyMeshControlEnvelope({
			payload,
			topicIdentity,
			identityField: MESH_IDENTITY_FIELD_BY_EVENT[eventName],
			toleranceMs: domia.peerStaleAfterMs,
			guard: meshGuard,
			isLastWill: eventName === MQTT_EVENT_ENUM.OFFLINE,
		})

		if (verdict.accepted && payload) {
			dispatchMeshEvent({
				eventName,
				payload,
				topicIdentity,
				mqttType,
				logger,
			})
			return
		}

		const reason: MeshControlRejectReasonType = verdict.reason ?? "malformed"
		const label = `${eventName} from ${topicIdentity}`
		if (payload && SIGNATURE_POLICY_REJECT_REASONS.has(reason)) {
			void signaturePolicyAllows(domia.domiaKey, logger)
				.then((allowed) => {
					warnDrop({
						identity: verdict.identity,
						reason,
						label,
						text: `⚠️ ${reason} ${label} — ${allowed ? "accepted (heartbeatSignatureRequired=false)" : "dropped"}`,
						logger,
					})
					if (allowed)
						dispatchMeshEvent({
							eventName,
							payload,
							topicIdentity,
							mqttType,
							logger,
						})
				})
				.catch((err: unknown) =>
					logger.warn(`signature policy lookup failed for ${topicIdentity}`, {
						err,
					}),
				)
			return
		}

		warnDrop({
			identity: verdict.identity,
			reason,
			label,
			text: `⚠️ ${label} dropped — ${reason}`,
			logger,
		})
	} catch (err) {
		logger.error("❌ Error parsing MQTT message", { topic, err })
	}
}
