import { type DomiaType } from "@/modules/core"
import { localMqttLogger } from "@/utils"

export const setupLocalMqtt = (domias: DomiaType[]) => {
	localMqttLogger.info("📡 Subscribing to local MQTT topics for Domia dumps")

	for (const domia of domias) {
		const topic = `domia/${domia.domiaKey}/local/#`
		localMqttLogger.info(`🔗 Subscribing to: ${topic}`)
		// localMqttClient.subscribe(topic)
	}

	// localMqttClient.on("message", (topic, message) => {
	// 	const parts = topic.split("/")
	// 	const [_, domiaKey, type, eventName] = parts

	// 	if (type !== "local" || !domiaKey || !eventName) return

	// 	try {
	// 		const payload = JSON.parse(message.toString())
	// 		const domiaId = domias.find((d) => d.domiaKey === domiaKey)?.id
	// 		if (!domiaId) return

	// 		const event = eventName as DOMIA_EVENT_BUS_ENUM
	// 		localMqttLogger.info(`📥 [LOCAL] ${event} from ${domiaKey}`, { payload })
	// 		publish(domiaId, event, payload)
	// 	} catch (err) {
	// 		localMqttLogger.error("❌ Error parsing MQTT message", { topic, err })
	// 	}
	// })
}
