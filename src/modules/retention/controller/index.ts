import { appLogger } from "@/utils"

import dbAdapter from "../db-adapter"

export const sweepRetention = (): void => {
	try {
		const counts = dbAdapter.pruneStaleRows()
		const orphans = dbAdapter.deleteOrphanSessionTraces()
		const removed =
			Object.values(counts).reduce((sum, n) => sum + n, 0) + orphans
		if (removed > 0) {
			appLogger.info(`🧹 retention swept ${removed} stale row(s)`)
		}
	} catch (err) {
		appLogger.warn("retention sweep failed", { err })
	}
}
