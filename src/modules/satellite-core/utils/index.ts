import type { ReconnectSchedulerType } from "../types"

export const createReconnectScheduler = (
	reconnectMs: number,
): ReconnectSchedulerType => {
	let closed = false
	let timer: ReturnType<typeof setTimeout> | null = null
	return {
		isClosed: () => closed,
		schedule: (fn) => {
			if (closed || timer) return
			timer = setTimeout(() => {
				timer = null
				if (!closed) fn()
			}, reconnectMs)
		},
		close: (onClose) => {
			closed = true
			if (timer) {
				clearTimeout(timer)
				timer = null
			}
			onClose?.()
		},
	}
}
