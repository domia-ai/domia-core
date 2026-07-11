import { DEFAULT_RETENTION_SWEEP_INTERVAL_MS } from "@/db"
import { sweepRetention } from "@/modules/retention"

export const setupRetention = (): void => {
	sweepRetention()
	const timer = setInterval(sweepRetention, DEFAULT_RETENTION_SWEEP_INTERVAL_MS)
	timer.unref()
}
