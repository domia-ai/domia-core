import type { DomiaType } from "@/modules/core"

const replyQueueWaitByInteraction = new Map<string, number>()

export const recordReplyQueueWait = (
	interactionId: string,
	waitMs: number,
): void => {
	if (replyQueueWaitByInteraction.size > 256) {
		const oldest = replyQueueWaitByInteraction.keys().next().value
		if (oldest) replyQueueWaitByInteraction.delete(oldest)
	}
	replyQueueWaitByInteraction.set(interactionId, waitMs)
}

export const takeReplyQueueWait = (interactionId: string): number | null => {
	const wait = replyQueueWaitByInteraction.get(interactionId)
	if (wait !== undefined) replyQueueWaitByInteraction.delete(interactionId)
	return wait ?? null
}

export const resourceCols = (domia: DomiaType) => {
	if (domia.moduleSettings?.metricsSampleResources === false) return {}
	const rss = process.memoryUsage().rss
	return { rssMb: Math.round(rss / (1024 * 1024)) }
}
