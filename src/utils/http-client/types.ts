export type FetchWithRetryOptions = {
	timeoutMs?: number
	retries?: number
	retryDelayMs?: number
	isRetryable?: (err: unknown) => boolean
	onRetry?: (err: unknown, attempt: number) => void
}
