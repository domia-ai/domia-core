import mqtt from "mqtt"

import { mqttLogger, localMqttLogger } from "@/utils"
import { env } from "@/config"
import { MQTT_TYPE_ENUM } from "@/db"
import { type DomiaType, getNodeId } from "@/modules/core"
import {
	setLocalMqttClient,
	getLocalMqttClient,
} from "@/modules/heartbeat-manager"
import type { SetupMqttArgsType } from "./types"
import { MQTT_EVENT_ENUM } from "./constants"
import { handleMqttMessage } from "@/modules/mqtt-event-handler"

const ROOT = env.MQTT_TOPIC_ROOT
const MQTT_CONNECT_TIMEOUT_MS = 5_000

export const setupMqtt = ({
	domia,
	config,
	nodeId,
}: SetupMqttArgsType): mqtt.MqttClient | null => {
	const type = config?.type
	const logger = config ? localMqttLogger : mqttLogger
	const domiaKey = domia?.domiaKey

	logger.info("🚀 Starting MQTT setup process")

	if (!config) {
		logger.warn("⚠️ No MQTT configuration provided, skipping setup")
		return null
	}

	logger.info("📋 MQTT configuration validated")

	logger.info("🔧 Creating MQTT client")
	const client = mqtt.connect(config.host, {
		clientId: domiaKey,
		username: config?.username || "",
		password: config?.password || "",
		protocol: config?.protocol,
		port: config?.port || 1883,
		will: nodeId
			? {
					topic: `${ROOT}/${nodeId}/${MQTT_TYPE_ENUM.LOCAL}/${MQTT_EVENT_ENUM.OFFLINE}`,
					payload: Buffer.from(JSON.stringify({ nodeId })),
					qos: 0,
					retain: false,
				}
			: undefined,
	})

	client.on("connect", () => {
		logger.success(`✅ MQTT client (${type}) ready and subscribed`)
	})

	client.on("error", (err) => {
		logger.error(`❌ ${type} MQTT connection error`, {
			name: err?.name,
			error: err?.message,
			stack: err?.stack,
			clientId: domiaKey,
			host: config.host,
		})
	})

	client.on("close", () => {
		logger.warn(`🔌 ${type} MQTT connection closed`)
	})

	client.on("reconnect", () => {
		logger.info(`🔄 ${type} MQTT attempting to reconnect`)
	})

	logger.info(
		"📡 Subscribing to heartbeat topic only (delegations now via gRPC)",
	)
	const heartbeatTopic = `${ROOT}/+/${type}/${MQTT_EVENT_ENUM.HEARTBEAT}`
	logger.info(`🔗 Subscribing to ${heartbeatTopic}`)
	client.subscribe(heartbeatTopic)

	const configChangedTopic = `${ROOT}/${domiaKey}/${type}/${MQTT_EVENT_ENUM.CONFIG_CHANGED}`
	client.subscribe(configChangedTopic)

	const offlineTopic = `${ROOT}/+/${type}/${MQTT_EVENT_ENUM.OFFLINE}`
	client.subscribe(offlineTopic)

	logger.success("✅ MQTT setup completed successfully")

	client.on("message", (topic, message) => {
		handleMqttMessage({
			domia,
			topic,
			message,
			logger,
		})
	})

	return client
}

export const reloadMqtt = async (domia: DomiaType): Promise<void> => {
	const nodeId = await getNodeId().catch(() => null)
	const next = setupMqtt({ domia, config: domia.localMqttConfig, nodeId })
	if (!next) {
		getLocalMqttClient()?.end()
		setLocalMqttClient(null)
		return
	}
	await new Promise<void>((resolve, reject) => {
		let settled = false
		const onConnect = (): void => finish()
		const onError = (err: Error): void => finish(err)
		const timer = setTimeout(
			() => finish(new Error("MQTT connect timeout")),
			MQTT_CONNECT_TIMEOUT_MS,
		)
		const finish = (err?: Error): void => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			next.removeListener("connect", onConnect)
			next.removeListener("error", onError)
			if (err) {
				next.end()
				reject(err)
			} else resolve()
		}
		next.once("connect", onConnect)
		next.on("error", onError)
	})
	const old = getLocalMqttClient()
	setLocalMqttClient(next)
	old?.end()
}
