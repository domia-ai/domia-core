const DEFAULT_TIMEOUT_MS = 15_000

export const fetchArrayBuffer = async (
	url: string,
	options?: { timeoutMs?: number },
): Promise<ArrayBuffer> => {
	const { timeoutMs = DEFAULT_TIMEOUT_MS } = options ?? {}
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), timeoutMs)
	try {
		const res = await fetch(url, { signal: controller.signal })
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}: ${res.statusText}`)
		}
		return await res.arrayBuffer()
	} finally {
		clearTimeout(timeout)
	}
}
