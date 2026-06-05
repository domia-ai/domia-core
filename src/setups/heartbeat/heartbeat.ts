import { heartbeatLogger } from "@/utils"
import type { SetupHeartbeatArgsType } from "./types"
import { sendHeartbeat } from "@/modules/heartbeat-manager"

export const setupHeartbeat = ({
	domia,
	intervalSeconds = 30,
	mqttClient,
}: SetupHeartbeatArgsType) => {
	const domiaKey = domia.domiaKey
	heartbeatLogger.info(`💓 Starting heartbeat loop for ${domiaKey}`)

	const interval = setInterval(() => {
		heartbeatLogger.info(`💓 Sending heartbeat for ${domiaKey}`)
		void sendHeartbeat({
			domia,
			mqttClient,
		})
	}, intervalSeconds * 1000)

	return interval
}
