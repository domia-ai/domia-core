import { DOMIA_EVENT_BUS_ENUM, publishToDomiaBus } from "@/buses"
import type { handleMqttMessageArgsType } from "../types"
import { MQTT_EVENT_ENUM } from "@/setups"
import { type DomiaType } from "@/modules/core"
import { receiveHeartbeat } from "@/modules/heartbeat-manager"

export const isDomiaBusEvent = (
	value: string,
): value is DOMIA_EVENT_BUS_ENUM => {
	return Object.values(DOMIA_EVENT_BUS_ENUM).includes(
		value as DOMIA_EVENT_BUS_ENUM,
	)
}

export const isMqttEvent = (value: string): value is MQTT_EVENT_ENUM => {
	return Object.values(MQTT_EVENT_ENUM).includes(value as MQTT_EVENT_ENUM)
}

export const handleMqttMessage = ({
	domia,
	topic,
	message,
	logger,
}: handleMqttMessageArgsType) => {
	const parts = topic?.split("/")
	const [, domiaKey, type, eventName] = parts

	logger.info(`domiaKey: ${domiaKey}`)
	logger.info(`type: ${type}`)
	logger.info(`eventName: ${eventName}`)

	if (!domiaKey || !eventName) return

	try {
		const payload = JSON.parse(message?.toString())
		if (isDomiaBusEvent(eventName)) {
			logger.info(`📥 [${type}] ${eventName} from ${domiaKey}`, { payload })
			publishToDomiaBus(domia?.id, eventName)
		} else if (isMqttEvent(eventName)) {
			logger.info(`📥 [${type}] ${eventName} from ${domiaKey}`)
			switch (eventName) {
				case MQTT_EVENT_ENUM.HEARTBEAT: {
					logger.info(`${eventName} received for domiaKey ${domiaKey}`)
					const domia = payload as DomiaType
					receiveHeartbeat({ domia })
				}
			}
		} else {
			logger.warn(`⚠️ Unknown MQTT event: ${eventName}`)
		}
	} catch (err) {
		logger.error("❌ Error parsing MQTT message", { topic, err })
	}
}
