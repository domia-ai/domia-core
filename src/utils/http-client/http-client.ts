import { domiaError, HTTP_ERRORS } from "../error"
import { DEFAULT_TIMEOUT_MS } from "./constants"

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

export const fetchArrayBuffer = async (
	url: string,
	options?: { timeoutMs?: number },
): Promise<ArrayBuffer> => {
	const { timeoutMs = DEFAULT_TIMEOUT_MS } = options ?? {}
	const res = await fetchWithTimeout(url, {}, timeoutMs)
	if (!res.ok) {
		throw domiaError(HTTP_ERRORS.REQUEST_FAILED, {
			meta: { url, status: res.status, statusText: res.statusText },
		})
	}
	return await res.arrayBuffer()
}
