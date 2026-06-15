export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

export const onceFn = (fn: () => void): (() => void) => {
	let called = false
	return () => {
		if (called) return
		called = true
		fn()
	}
}

export const withTimeout = <T>(
	promise: Promise<T>,
	ms: number,
	label = "operation",
): Promise<T> =>
	Promise.race([
		promise,
		new Promise<T>((_, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`${label} timed out after ${ms}ms`)),
				ms,
			)
			timer.unref?.()
		}),
	])

const SEMAPHORE_BUSY_CODE = "SEMAPHORE_BUSY"

export const semaphoreBusyError = (
	message = "semaphore queue is full",
): Error => {
	const err = new Error(message) as Error & { code?: string }
	err.code = SEMAPHORE_BUSY_CODE
	return err
}

export const isSemaphoreBusyError = (err: unknown): boolean =>
	!!err &&
	typeof err === "object" &&
	(err as { code?: string }).code === SEMAPHORE_BUSY_CODE

export const createAsyncSemaphore = (
	initialLimit: number,
	initialMaxWaiters: number = Number.POSITIVE_INFINITY,
) => {
	let limit = Math.max(1, initialLimit)
	let maxWaiters = Math.max(0, initialMaxWaiters)
	let active = 0
	const waiters: (() => void)[] = []

	const wake = (): void => {
		const slots = limit - active
		for (let i = 0; i < slots; i++) {
			const next = waiters.shift()
			if (!next) break
			next()
		}
	}

	const waitTurn = (deadline: number | null): Promise<void> =>
		new Promise<void>((resolve, reject) => {
			let timer: ReturnType<typeof setTimeout> | undefined
			const onWake = (): void => {
				if (timer) clearTimeout(timer)
				resolve()
			}
			waiters.push(onWake)
			if (deadline !== null) {
				timer = setTimeout(
					() => {
						const i = waiters.indexOf(onWake)
						if (i >= 0) waiters.splice(i, 1)
						reject(semaphoreBusyError("semaphore wait timed out"))
					},
					Math.max(0, deadline - Date.now()),
				)
			}
		})

	const acquire = async (options?: {
		timeoutMs?: number
	}): Promise<() => void> => {
		if (active >= limit && waiters.length >= maxWaiters) {
			throw semaphoreBusyError()
		}
		const deadline =
			options?.timeoutMs != null ? Date.now() + options.timeoutMs : null
		while (active >= limit) {
			await waitTurn(deadline)
		}
		active++
		let released = false
		return () => {
			if (released) return
			released = true
			active--
			wake()
		}
	}

	return {
		acquire,
		activeCount: (): number => active,
		waitingCount: (): number => waiters.length,
		setLimit: (next: number): void => {
			limit = Math.max(1, next)
			wake()
		},
		setMaxWaiters: (next: number): void => {
			maxWaiters = Math.max(0, next)
		},
	}
}
