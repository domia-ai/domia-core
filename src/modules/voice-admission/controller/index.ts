import { createAsyncSemaphore } from "@/utils"
import type { DomiaType } from "@/modules/core"

type SemaphoreType = ReturnType<typeof createAsyncSemaphore>

const semaphores = new Map<string, SemaphoreType>()

const semaphoreFor = (domiaId: string): SemaphoreType => {
	let semaphore = semaphores.get(domiaId)
	if (!semaphore) {
		semaphore = createAsyncSemaphore(2, 4)
		semaphores.set(domiaId, semaphore)
	}
	return semaphore
}

const sumAcross = (read: (s: SemaphoreType) => number): number => {
	let total = 0
	for (const semaphore of semaphores.values()) total += read(semaphore)
	return total
}

export const admitVoiceReply = async (
	domia: DomiaType,
): Promise<() => void> => {
	const semaphore = semaphoreFor(domia.id)
	semaphore.setLimit(domia?.maxConcurrentVoiceReplies ?? 2)
	semaphore.setMaxWaiters(domia?.maxQueuedVoiceReplies ?? 4)
	return semaphore.acquire({ timeoutMs: domia?.voiceQueueTimeoutMs })
}

export const activeVoiceReplies = (domiaId?: string): number =>
	domiaId
		? (semaphores.get(domiaId)?.activeCount() ?? 0)
		: sumAcross((s) => s.activeCount())

export const queuedVoiceReplies = (domiaId?: string): number =>
	domiaId
		? (semaphores.get(domiaId)?.waitingCount() ?? 0)
		: sumAcross((s) => s.waitingCount())
