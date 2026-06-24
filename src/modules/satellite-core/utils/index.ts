import {
	DEFAULT_SATELLITE_RECONNECT_MAX_MS,
	DEFAULT_SATELLITE_RECONNECT_JITTER,
} from "@/db"
import type { ReconnectSchedulerType } from "../types"

export const createReconnectScheduler = (
	reconnectMs: number,
	maxMs: number = DEFAULT_SATELLITE_RECONNECT_MAX_MS,
	jitter: number = DEFAULT_SATELLITE_RECONNECT_JITTER,
): ReconnectSchedulerType => {
	let closed = false
	let timer: ReturnType<typeof setTimeout> | null = null
	let attempts = 0

	const delayFor = (n: number): number => {
		const base = Math.min(reconnectMs * 2 ** n, maxMs)
		const spread = base * jitter
		return Math.round(base - spread + Math.random() * spread * 2)
	}

	return {
		isClosed: () => closed,
		attempts: () => attempts,
		reset: () => {
			attempts = 0
		},
		schedule: (fn) => {
			if (closed || timer) return
			const wait = delayFor(attempts)
			attempts++
			timer = setTimeout(() => {
				timer = null
				if (!closed) fn()
			}, wait)
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
