import mqtt from "mqtt"

import { mqttLogger, localMqttLogger, remoteMqttLogger } from "@/utils"
import type { SetupMqttArgsType } from "./types"
import { MQTT_EVENT_ENUM } from "./constants"
import { handleMqttMessage } from "@/modules/mqtt-event-handler"

export const setupMqtt = ({
	domia,
	config,
}: SetupMqttArgsType): mqtt.MqttClient | null => {
	const type = config?.type
	const logger = !config
		? mqttLogger
		: type === "REMOTE"
			? remoteMqttLogger
			: localMqttLogger
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

	logger.info("📡 Starting topic subscription process")
	const topic = `domia/${domiaKey}/${type}/#`
	logger.info(`🔗 Subscribing to topic ${topic}`)
	client.subscribe(topic)
	const heartbeatTopic = `domia/+/${type}/${MQTT_EVENT_ENUM.HEARTBEAT}`
	logger.info(`🔗 Subscribing to heartbeat topic ${heartbeatTopic}`)
	client.subscribe(heartbeatTopic)

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
