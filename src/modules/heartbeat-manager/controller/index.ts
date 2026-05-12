import { MQTT_TYPE_ENUM } from "@/db"
import { MQTT_EVENT_ENUM } from "@/setups"
import type { ReceiveHeartbeatArgsType, SendHeartbeatArgsType } from "../types"
import { heartbeatLogger } from "@/utils"
import { env } from "@/config"
import { getLocalIp, upsertDomiaFromNetwork } from "@/modules/network-sync"

export const sendHeartbeat = ({ domia, mqttClient }: SendHeartbeatArgsType) => {
	try {
		const domiaKey = domia?.domiaKey
		const topic = `domia/${domiaKey}/${MQTT_TYPE_ENUM.LOCAL}/${MQTT_EVENT_ENUM.HEARTBEAT}`
		heartbeatLogger.debug(`💓 Heartbeat sent for ${domiaKey}`)
		const localIp = getLocalIp()
		const grpcPort = Number(env.GRPC_PORT)
		mqttClient?.publish(topic, JSON.stringify({ ...domia, localIp, grpcPort }))
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
