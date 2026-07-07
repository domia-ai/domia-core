import {
	createInferencePool,
	createChildProcessBackend,
	resolveMaxWorkers,
	type InferencePoolType,
} from "@/modules/inference-pool"
import type { SelectSttConfigType } from "@/db"

let sttPool: InferencePoolType | null = null

export const getSttPool = (
	sttConfig: SelectSttConfigType,
): InferencePoolType => {
	if (!sttPool) {
		const maxWorkers = sttConfig.poolAutoScaleEnabled
			? resolveMaxWorkers(sttConfig.poolMaxWorkers, "stt")
			: Math.max(1, sttConfig.poolWarmWorkers)
		const maxConcurrentSessions =
			sttConfig.maxConcurrentStreamingSessions > 0
				? sttConfig.maxConcurrentStreamingSessions
				: Math.max(1, maxWorkers - 1)
		sttPool = createInferencePool({
			label: "stt",
			backend: createChildProcessBackend("stt-entry"),
			warmWorkers: sttConfig.poolWarmWorkers,
			maxWorkers,
			idleTimeoutMs: sttConfig.poolIdleTimeoutMs,
			queueMaxDepth: sttConfig.poolQueueMaxDepth,
			queueTimeoutMs: sttConfig.poolQueueTimeoutMs,
			executionTimeoutMs: sttConfig.poolExecutionTimeoutMs,
			recycleAfterJobs: sttConfig.workerRecycleAfterJobs,
			maxConcurrentSessions,
			sessionIdleTimeoutMs: sttConfig.sessionIdleTimeoutMs,
		})
	}
	return sttPool
}

export const sttPoolBusy = (): boolean =>
	sttPool !== null && (sttPool.busyWorkers() > 0 || sttPool.queuedJobs() > 0)

export const reloadSttPool = async (): Promise<void> => {
	const old = sttPool
	sttPool = null
	if (old) await old.shutdown()
}
