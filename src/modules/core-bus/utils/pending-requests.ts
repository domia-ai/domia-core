type PendingEntry = {
	resolve: (reply: string) => void
	reject: (err: Error) => void
	timeoutId: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingEntry>()

export const registerPending = (
	interactionId: string,
	timeoutMs: number,
): Promise<string> => {
	return new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			pending.delete(interactionId)
			reject(new Error("LLM response timeout"))
		}, timeoutMs)
		pending.set(interactionId, { resolve, reject, timeoutId })
	})
}

export const resolvePending = (interactionId: string, reply: string): void => {
	const entry = pending.get(interactionId)
	if (!entry) return
	clearTimeout(entry.timeoutId)
	pending.delete(interactionId)
	entry.resolve(reply)
}

export const rejectPending = (interactionId: string, err: Error): void => {
	const entry = pending.get(interactionId)
	if (!entry) return
	clearTimeout(entry.timeoutId)
	pending.delete(interactionId)
	entry.reject(err)
}
