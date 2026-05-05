const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRY_DELAY_MS = 250
const DEFAULT_RETRYABLE_PATTERN =
	/ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|HTTP 50[234]/i

export type FetchWithRetryOptions = {
	timeoutMs?: number
	retries?: number
	retryDelayMs?: number
	isRetryable?: (err: unknown) => boolean
	onRetry?: (err: unknown, attempt: number) => void
}

export const fetchWithTimeout = async (
	url: string,
	init: RequestInit = {},
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> => {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		return await fetch(url, { ...init, signal: controller.signal })
	} finally {
		clearTimeout(timer)
	}
}

export const isRetryableHttpError = (err: unknown): boolean => {
	const msg = err instanceof Error ? err.message : String(err)
	return DEFAULT_RETRYABLE_PATTERN.test(msg)
}

export const fetchWithRetry = async (
	url: string,
	init: RequestInit = {},
	options: FetchWithRetryOptions = {},
): Promise<Response> => {
	const {
		timeoutMs = DEFAULT_TIMEOUT_MS,
		retries = 1,
		retryDelayMs = DEFAULT_RETRY_DELAY_MS,
		isRetryable = isRetryableHttpError,
		onRetry,
	} = options

	let lastErr: unknown
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const res = await fetchWithTimeout(url, init, timeoutMs)
			if (res.status >= 500 && res.status !== 501) {
				throw new Error(`HTTP ${res.status}`)
			}
			return res
		} catch (err) {
			lastErr = err
			if (attempt >= retries || !isRetryable(err)) throw err
			onRetry?.(err, attempt + 1)
			await new Promise((r) => setTimeout(r, retryDelayMs))
		}
	}
	throw lastErr
}

export const fetchArrayBuffer = async (
	url: string,
	options?: { timeoutMs?: number },
): Promise<ArrayBuffer> => {
	const { timeoutMs = DEFAULT_TIMEOUT_MS } = options ?? {}
	const res = await fetchWithTimeout(url, {}, timeoutMs)
	if (!res.ok) {
		throw new Error(`HTTP ${res.status}: ${res.statusText}`)
	}
	return await res.arrayBuffer()
}

export const fetchArrayBufferWithRetry = async (
	url: string,
	options?: FetchWithRetryOptions,
): Promise<ArrayBuffer> => {
	const res = await fetchWithRetry(url, {}, options)
	if (!res.ok) {
		throw new Error(`HTTP ${res.status}: ${res.statusText}`)
	}
	return await res.arrayBuffer()
}
