import {
	createInferencePool,
	createChildProcessBackend,
	resolveMaxWorkers,
	type InferencePoolType,
} from "@/modules/inference-pool"
import type { SelectSttConfigType } from "@/db"

let sttPool: InferencePoolType | null = null

export const createSttPool = (
	sttConfig: SelectSttConfigType,
): InferencePoolType => {
	const maxWorkers = sttConfig.poolAutoScaleEnabled
		? resolveMaxWorkers(sttConfig.poolMaxWorkers, "stt")
		: Math.max(1, sttConfig.poolWarmWorkers)
	const maxConcurrentSessions =
		sttConfig.maxConcurrentStreamingSessions > 0
			? sttConfig.maxConcurrentStreamingSessions
			: Math.max(1, maxWorkers - 1)
	return createInferencePool({
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

export const getSttPool = (
	sttConfig: SelectSttConfigType,
): InferencePoolType => {
	sttPool ??= createSttPool(sttConfig)
	return sttPool
}

export const sttPoolBusy = (): boolean =>
	sttPool !== null && (sttPool.busyWorkers() > 0 || sttPool.queuedJobs() > 0)

export const swapSttPool = async (
	next: InferencePoolType | null,
): Promise<void> => {
	const old = sttPool
	sttPool = next
	if (old) await old.shutdown()
}

export const shutdownSttPool = (): Promise<void> => swapSttPool(null)
