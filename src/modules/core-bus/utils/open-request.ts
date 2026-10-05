import {
	DEFAULT_ELICIT_TTL_MS,
	DEFAULT_OPEN_REQUEST_ANSWER_MAX_WORDS,
} from "@/db"

import type { OpenRequestType } from "../types"

const openRequests = new Map<string, OpenRequestType>()

export const setOpenRequest = (scope: string, transcript: string): void => {
	openRequests.set(scope, { transcript, at: Date.now() })
}

export const clearOpenRequest = (scope: string): void => {
	openRequests.delete(scope)
}

export const takeOpenRequest = (
	scope: string,
	answer: string,
): OpenRequestType | null => {
	const open = openRequests.get(scope)
	if (!open) return null
	openRequests.delete(scope)
	const words = answer.trim().split(/\s+/).filter(Boolean).length
	const fresh = Date.now() - open.at <= DEFAULT_ELICIT_TTL_MS
	return fresh && words > 0 && words <= DEFAULT_OPEN_REQUEST_ANSWER_MAX_WORDS
		? open
		: null
}
