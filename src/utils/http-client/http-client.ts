import {
	DEFAULT_TIMEOUT_MS,
	DEFAULT_RETRY_DELAY_MS,
	MAX_RETRY_AFTER_MS,
	DEFAULT_RETRYABLE_PATTERN,
} from "./constants"
import type { FetchWithRetryOptions } from "./types"

class HttpRetryError extends Error {
	constructor(
		message: string,
		public readonly retryAfterMs: number | null,
	) {
		super(message)
		this.name = "HttpRetryError"
	}
}

const parseRetryAfterMs = (res: Response): number | null => {
	const header = res.headers.get("retry-after")
	if (!header) return null
	const seconds = Number(header)
	if (Number.isFinite(seconds))
		return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, seconds * 1000))
	const date = Date.parse(header)
	if (Number.isFinite(date))
		return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, date - Date.now()))
	return null
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
			if (res.status === 429 || (res.status >= 500 && res.status !== 501)) {
				throw new HttpRetryError(`HTTP ${res.status}`, parseRetryAfterMs(res))
			}
			return res
		} catch (err) {
			lastErr = err
			if (attempt >= retries || !isRetryable(err)) throw err
			onRetry?.(err, attempt + 1)
			const delay =
				err instanceof HttpRetryError && err.retryAfterMs !== null
					? err.retryAfterMs
					: retryDelayMs
			await new Promise((r) => setTimeout(r, delay))
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
