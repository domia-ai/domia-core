import {
	createInferencePool,
	createChildProcessBackend,
	resolveMaxWorkers,
	drainAndShutdown,
	type InferencePoolType,
} from "@/modules/inference-pool"
import type { SelectSttConfigType } from "@/db"

const POOL_RECYCLE_DRAIN_TIMEOUT_MS = 15_000

let sttPool: InferencePoolType | null = null

export const getSttPool = (
	sttConfig: SelectSttConfigType,
): InferencePoolType => {
	if (!sttPool) {
		const maxWorkers = sttConfig.poolAutoScaleEnabled
			? resolveMaxWorkers(sttConfig.poolMaxWorkers)
			: Math.max(1, sttConfig.poolWarmWorkers)
		sttPool = createInferencePool({
			label: "stt",
			backend: createChildProcessBackend("stt-entry"),
			warmWorkers: sttConfig.poolWarmWorkers,
			maxWorkers,
			idleTimeoutMs: sttConfig.poolIdleTimeoutMs,
			queueMaxDepth: sttConfig.poolQueueMaxDepth,
			queueTimeoutMs: sttConfig.poolQueueTimeoutMs,
			recycleAfterJobs: sttConfig.workerRecycleAfterJobs,
		})
	}
	return sttPool
}

export const recycleSttPool = async (): Promise<void> => {
	const pool = sttPool
	sttPool = null
	if (pool) await drainAndShutdown(pool, POOL_RECYCLE_DRAIN_TIMEOUT_MS)
}
