import { createAsyncSemaphore } from "@/utils"
import type { DomiaType } from "@/modules/core"

const voiceSemaphore = createAsyncSemaphore(2, 4)

export const admitVoiceReply = async (
	domia: DomiaType,
): Promise<() => void> => {
	voiceSemaphore.setLimit(domia?.maxConcurrentVoiceReplies ?? 2)
	voiceSemaphore.setMaxWaiters(domia?.maxQueuedVoiceReplies ?? 4)
	return voiceSemaphore.acquire({ timeoutMs: domia?.voiceQueueTimeoutMs })
}

export const activeVoiceReplies = (): number => voiceSemaphore.activeCount()

export const queuedVoiceReplies = (): number => voiceSemaphore.waitingCount()
