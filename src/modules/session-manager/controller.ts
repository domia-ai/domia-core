import { type DomiaType } from "@/modules/core"
import { generateUuid } from "@/utils"

import { DBClientOrTxType, UpdateInteractionTraceType } from "@/db"
import dbAdapter from "./db-adapter"
import type { NewInteractionDataType } from "./types"

export const getOrCreateSessionForDomia = async (domia: DomiaType) => {
	const now = Date.now()
	const domiaId = domia?.id
	const timeoutMs = domia?.sessionIdTimeoutMs ?? 300_000

	const [existingSession] =
		await dbAdapter.getExistingInteractionSessionTrace(domiaId)
	const lastUsedAt = existingSession?.lastUsedAt
		? new Date(existingSession.lastUsedAt + "Z").getTime()
		: null
	const expired = lastUsedAt !== null ? now - lastUsedAt > timeoutMs : true
	if (existingSession && !expired) {
		await dbAdapter.updateInteractionSessionTrace(existingSession)

		return {
			interactionSessionTraceId: existingSession.id,
			sessionId: existingSession.sessionId,
		}
	}

	const newId = generateUuid()
	const newSessionId = generateUuid()

	await dbAdapter.insertInteractionSessionTrace({
		id: newId,
		sessionId: newSessionId,
		domiaId,
	})

	return {
		interactionSessionTraceId: newId,
		sessionId: newSessionId,
	}
}

export const registerNewInteraction = async (
	domia: DomiaType,
	data: NewInteractionDataType,
	client?: DBClientOrTxType,
) => {
	const interactionId = generateUuid()

	const { interactionSessionTraceId, sessionId } =
		await getOrCreateSessionForDomia(domia)

	await dbAdapter.insertInteractionTrace(
		{
			...data,
			id: interactionId,
			domiaId: domia.id,
			interactionSessionTraceId,
			sessionId,
		},
		client,
	)

	return {
		interactionId,
		interactionSessionTraceId,
		sessionId,
		domiaId: domia.id,
	}
}

export const updateInteraction = async (
	data: UpdateInteractionTraceType,
	client?: DBClientOrTxType,
) => {
	await dbAdapter.updateInteractionTrace(data, client)
}
