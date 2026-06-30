import { heartbeatLogger } from "@/utils"
import type { SetupHeartbeatArgsType } from "./types"
import { sendHeartbeat } from "@/modules/heartbeat-manager"
import { getOwnDomia } from "@/modules/core"

export const setupHeartbeat = ({
	domia,
	intervalSeconds = 30,
}: SetupHeartbeatArgsType) => {
	const domiaKey = domia.domiaKey
	heartbeatLogger.info(`💓 Starting heartbeat loop for ${domiaKey}`)

	return setInterval(() => {
		void (async () => {
			const live = (await getOwnDomia(domiaKey).catch(() => null)) ?? domia
			heartbeatLogger.info(`💓 Sending heartbeat for ${domiaKey}`)
			await sendHeartbeat({ domia: live })
		})()
	}, intervalSeconds * 1000)
}
