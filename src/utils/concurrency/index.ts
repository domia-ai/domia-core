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

export const withIdleTimeout = async function* <T>(
	source: AsyncIterable<T>,
	ms: number,
	label: string,
): AsyncIterable<T> {
	const it = source[Symbol.asyncIterator]()
	try {
		for (;;) {
			const res = await withTimeout(it.next(), ms, `${label} stream idle`)
			if (res.done) return
			yield res.value
		}
	} finally {
		try {
			await it.return?.()
		} catch {
			/* source already closed */
		}
	}
}

export const createKeyedMutex = (): (<T>(
	key: string,
	fn: () => Promise<T>,
) => Promise<T>) => {
	const mutexes = new Map<string, ReturnType<typeof createAsyncSemaphore>>()
	return async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
		const mutex = mutexes.get(key) ?? createAsyncSemaphore(1)
		mutexes.set(key, mutex)
		const release = await mutex.acquire()
		try {
			return await fn()
		} finally {
			release()
		}
	}
}

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
