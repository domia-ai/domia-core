import { AUTH_EXEMPT_AUDIO_KINDS, AUTH_EXEMPT_PATHS } from "../constants"
import { getAudioQuerySchema } from "../schemas"

const AUDIO_PATH_PREFIX = "/audio/"

const audioKindIsExempt = (search: string): boolean => {
	const raw = new URLSearchParams(search).get("kind")
	const parsed = getAudioQuerySchema.safeParse(
		raw === null ? {} : { kind: raw },
	)
	return parsed.success && AUTH_EXEMPT_AUDIO_KINDS.has(parsed.data.kind)
}

export const isAuthExemptRequest = (method: string, url: string): boolean => {
	const queryAt = url.indexOf("?")
	const pathname = queryAt === -1 ? url : url.slice(0, queryAt)
	if (AUTH_EXEMPT_PATHS.has(pathname)) return true
	if (method !== "GET" || !pathname.startsWith(AUDIO_PATH_PREFIX)) return false
	return audioKindIsExempt(queryAt === -1 ? "" : url.slice(queryAt + 1))
}
