import { MQTT_TYPE_ENUM } from "@/db"
import { MQTT_EVENT_ENUM } from "@/setups/mqtt/constants"
import type { ReceiveHeartbeatArgsType, SendHeartbeatArgsType } from "../types"
import { heartbeatLogger } from "@/utils"
import { env } from "@/config"
import { getLocalIp, upsertDomiaFromNetwork } from "@/modules/network-sync"
import { getLastInteractionAt } from "@/modules/session-manager"
import { getLastEmotionEventAt } from "@/modules/emotion-engine"
import { getLastFactAt } from "@/modules/memory"

export const sendHeartbeat = async ({
	domia,
	mqttClient,
}: SendHeartbeatArgsType) => {
	try {
		const domiaKey = domia?.domiaKey
		const topic = `domia/${domiaKey}/${MQTT_TYPE_ENUM.LOCAL}/${MQTT_EVENT_ENUM.HEARTBEAT}`
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

		const payload: Record<string, unknown> = {
			...domia,
			localIp,
			grpcPort,
			httpPort,
			lastInteractionAt,
		}
		delete payload.mqttConfigs
		delete payload.localMqttConfig
		mqttClient?.publish(topic, JSON.stringify(payload))
	} catch (err) {
		heartbeatLogger.error(`❌ Failed to send heartbeat`, { err })
	}
}

export const receiveHeartbeat = async ({ domia }: ReceiveHeartbeatArgsType) => {
	const domiaKey = domia?.domiaKey
	heartbeatLogger.info(`💓 Heartbeat received for ${domiaKey}`)

	if (domiaKey === env.DOMIA_KEY) {
		heartbeatLogger.info("🧠 Skipping own heartbeat")
		return
	}

	heartbeatLogger.info(`🧠 Upserting Domia record for ${domiaKey}`)
	await upsertDomiaFromNetwork(domia)
}
