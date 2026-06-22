import type { handleMqttMessageArgsType } from "../types"
import { MQTT_EVENT_ENUM } from "@/setups/mqtt/constants"
import { type DomiaType, invalidateOwnDomia, getOwnDomia } from "@/modules/core"
import { setGrpcClientTunables } from "@/modules/grpc-client"
import { receiveHeartbeat } from "@/modules/heartbeat-manager"

export const isMqttEvent = (value: string): value is MQTT_EVENT_ENUM => {
	return Object.values(MQTT_EVENT_ENUM).includes(value as MQTT_EVENT_ENUM)
}

export const handleMqttMessage = ({
	topic,
	message,
	logger,
}: handleMqttMessageArgsType) => {
	const parts = topic?.split("/")
	const [, domiaKey, type, eventName] = parts

	if (!domiaKey || !eventName) return
	if (!isMqttEvent(eventName)) return

	try {
		const payload = JSON.parse(message?.toString())
		switch (eventName) {
			case MQTT_EVENT_ENUM.HEARTBEAT: {
				if (
					typeof payload !== "object" ||
					payload === null ||
					typeof payload.domiaKey !== "string" ||
					payload.domiaKey.length === 0
				) {
					logger.warn(
						`⚠️ malformed heartbeat payload from ${domiaKey} — ignored`,
					)
					break
				}
				logger.info(`💓 heartbeat from ${domiaKey} [${type}]`)
				void receiveHeartbeat({ domia: payload as DomiaType }).catch(
					(err: unknown) =>
						logger.error(`❌ heartbeat upsert failed for ${domiaKey}`, { err }),
				)
				break
			}
			case MQTT_EVENT_ENUM.CONFIG_CHANGED: {
				invalidateOwnDomia(domiaKey)
				void getOwnDomia(domiaKey)
					.then((fresh) => fresh && setGrpcClientTunables(fresh))
					.catch(() => undefined)
				logger.info(`🔄 config cache invalidated via MQTT [${domiaKey}]`)
				break
			}
			default:
				logger.warn(`⚠️ unhandled MQTT event: ${eventName}`)
		}
	} catch (err) {
		logger.error("❌ Error parsing MQTT message", { topic, err })
	}
}
