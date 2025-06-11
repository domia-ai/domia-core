import { type DomiaType } from "@/modules/core"
import { remoteMqttLogger } from "@/utils"

export const setupRemoteMqtt = (domias: DomiaType[]) => {
	remoteMqttLogger.info(
		"🌐 Subscribing to remote MQTT topics for Domia cloud control and communication",
	)

	for (const domia of domias) {
		const topic = `domia/${domia.domiaKey}/remote/#`
		remoteMqttLogger.info(`🔗 Subscribing to: ${topic}`)
		// remoteMqttClient.subscribe(topic)
	}

	// remoteMqttClient.on("message", (topic, message) => {
	// 	const parts = topic.split("/")
	// 	const [_, domiaKey, type, eventName] = parts

	// 	if (type !== "remote" || !domiaKey || !eventName) return

	// 	try {
	// 		const payload = JSON.parse(message.toString())
	// 		const domiaId = domias.find((d) => d.domiaKey === domiaKey)?.id
	// 		if (!domiaId) return

	// 		const event = eventName as DOMIA_EVENT_BUS_ENUM
	// 		remoteMqttLogger.info(`📥 [REMOTE] ${event} from ${domiaKey}`, {
	// 			payload,
	// 		})
	// 		publish(domiaId, event, payload)
	// 	} catch (err) {
	// 		remoteMqttLogger.error("❌ Error parsing MQTT message", { topic, err })
	// 	}
	// })
}
