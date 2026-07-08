import { languageSetsFor } from "@/utils"
import { DEFAULT_CONFIRMATION_TTL_MS } from "@/db"
import type { PendingConfirmationType } from "../types"

const store = new Map<string, PendingConfirmationType>()

export const confirmationScope = (
	domiaKey: string,
	satelliteId?: string | null,
): string => `${domiaKey}:${satelliteId ?? "local"}`

const liveEntry = (scope: string): PendingConfirmationType | null => {
	const e = store.get(scope)
	if (!e) return null
	if (Date.now() > e.expiresAt) {
		store.delete(scope)
		return null
	}
	return e
}

export const parkConfirmation = (
	scope: string,
	entry: Omit<PendingConfirmationType, "expiresAt">,
	ttlMs = DEFAULT_CONFIRMATION_TTL_MS,
): void => {
	store.set(scope, { ...entry, expiresAt: Date.now() + ttlMs })
}

export const peekPendingConfirmation = (
	scope: string,
): PendingConfirmationType | null => liveEntry(scope)

export const takePendingConfirmation = (
	scope: string,
): PendingConfirmationType | null => {
	const e = liveEntry(scope)
	if (e) store.delete(scope)
	return e
}

export const markConfirmationReasked = (scope: string): void => {
	const e = liveEntry(scope)
	if (e) e.reasked = true
}

export const clearPendingConfirmation = (scope: string): void => {
	store.delete(scope)
}

const normalizeReply = (transcript: string): string =>
	transcript
		.trim()
		.toLowerCase()
		.replace(/[.,!¡¿?]/g, "")

const matchesShortReply = (
	transcript: string,
	vocabulary: Set<string>,
): boolean => {
	const normalized = normalizeReply(transcript)
	if (!normalized) return false
	if (vocabulary.has(normalized)) return true
	const words = normalized.split(/\s+/)
	return words.length <= 4 && words.some((w) => vocabulary.has(w))
}

export const isAffirmative = (
	transcript: string,
	language: string | null,
): boolean =>
	matchesShortReply(transcript, languageSetsFor(language).affirmations)

export const isNegative = (
	transcript: string,
	language: string | null,
): boolean => matchesShortReply(transcript, languageSetsFor(language).negations)
