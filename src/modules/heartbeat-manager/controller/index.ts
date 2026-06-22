import type { MqttClient } from "mqtt"

import { MQTT_TYPE_ENUM } from "@/db"
import { MQTT_EVENT_ENUM } from "@/setups/mqtt/constants"
import type { ReceiveHeartbeatArgsType, SendHeartbeatArgsType } from "../types"
import { heartbeatLogger } from "@/utils"
import { env } from "@/config"
import { isHostedIdentity, getDomia, getNodeId } from "@/modules/core"
import { getLocalIp, upsertDomiaFromNetwork } from "@/modules/network-sync"
import { getLastInteractionAt } from "@/modules/session-manager"
import { getLastEmotionEventAt } from "@/modules/emotion-engine"
import { getLastFactAt } from "@/modules/memory"

let localMqttClient: MqttClient | null = null

export const setLocalMqttClient = (client: MqttClient | null): void => {
	localMqttClient = client
}

export const publishIdentityState = async (domiaKey: string): Promise<void> => {
	const domia = await getDomia(domiaKey).catch(() => null)
	if (!domia) return
	await sendHeartbeat({ domia, mqttClient: localMqttClient })
}

export const sendHeartbeat = async ({
	domia,
	mqttClient,
}: SendHeartbeatArgsType) => {
	try {
		const domiaKey = domia?.domiaKey
		const topic = `${env.MQTT_TOPIC_ROOT}/${domiaKey}/${MQTT_TYPE_ENUM.LOCAL}/${MQTT_EVENT_ENUM.HEARTBEAT}`
		heartbeatLogger.debug(`💓 Heartbeat sent for ${domiaKey}`)
		const localIp = getLocalIp()
		const grpcPort = Number(env.GRPC_PORT)
		const httpPort = Number(env.HTTP_SERVER_PORT)
		const [interactionAt, emotionAt, factAt] = await Promise.all([
			getLastInteractionAt(domia.id),
			getLastEmotionEventAt(domia.id),
			getLastFactAt(domia.id),
		])
		const stamps = [interactionAt, emotionAt, factAt].filter((s): s is string =>
			Boolean(s),
		)
		const lastInteractionAt = stamps.length
			? stamps.reduce((a, b) => (a > b ? a : b))
			: null

		const nodeId = await getNodeId().catch(() => null)
		const payload: Record<string, unknown> = {
			...domia,
			nodeId,
			localIp,
			grpcPort,
			httpPort,
			isPrincipal: domiaKey === env.DOMIA_KEY,
			lastInteractionAt,
		}
		delete payload.mqttConfigs
		delete payload.localMqttConfig
		if (domia.skillProviders?.length)
			payload.skillProviders = domia.skillProviders.map((p) => ({
				...p,
				auth: p.auth?.kind ? { kind: p.auth.kind } : null,
			}))
		mqttClient?.publish(topic, JSON.stringify(payload))
	} catch (err) {
		heartbeatLogger.error(`❌ Failed to send heartbeat`, { err })
	}
}

export const receiveHeartbeat = async ({ domia }: ReceiveHeartbeatArgsType) => {
	const domiaKey = domia?.domiaKey
	heartbeatLogger.info(`💓 Heartbeat received for ${domiaKey}`)

	if (domiaKey && isHostedIdentity(domiaKey)) {
		heartbeatLogger.info("🧠 Skipping own heartbeat")
		return
	}

	const incomingNodeId = (domia as { nodeId?: string | null }).nodeId
	const ownNodeId = await getNodeId().catch(() => null)
	if (incomingNodeId && ownNodeId && incomingNodeId === ownNodeId) {
		heartbeatLogger.info("🧠 Skipping heartbeat from own hub (nodeId match)")
		return
	}

	heartbeatLogger.info(`🧠 Upserting Domia record for ${domiaKey}`)
	await upsertDomiaFromNetwork(domia)
}
