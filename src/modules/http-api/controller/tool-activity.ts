import type { FastifyReply } from "fastify"

import type { ToolRunStatusEnumType } from "@/db"
import {
	confirmationScope,
	listPendingConfirmations,
	settlePendingConfirmation,
} from "@/modules/agent"
import { listToolRuns } from "@/modules/skill-engine"
import { httpServerLogger } from "@/utils"

import {
	getToolRunsQuerySchema,
	postConfirmationSettleBodySchema,
} from "../schemas"
import { badRequest, notFound } from "../utils/http-errors"
import { resolveHostedIdentity } from "../utils/hosted-identity"
import type {
	GetConfirmationsResponseType,
	GetToolRunsResponseType,
	PostConfirmationSettleResponseType,
} from "../types"

export const handleGetToolRuns = async (
	query: unknown,
	reply: FastifyReply,
) => {
	const parsed = getToolRunsQuerySchema.safeParse(query ?? {})
	if (!parsed.success) return badRequest(reply, parsed.error, "Invalid query")
	const identity = await resolveHostedIdentity(parsed.data.domiaKey, reply)
	if (!identity) return
	const statuses = parsed.data.status
		?.split(",")
		.map((value) => value.trim() as ToolRunStatusEnumType)
	const response: GetToolRunsResponseType = {
		toolRuns: listToolRuns(
			identity.id,
			{
				interactionId: parsed.data.interactionId,
				tool: parsed.data.tool,
				statuses,
				since: parsed.data.since || undefined,
			},
			parsed.data.limit,
		),
	}
	return response
}

export const handleGetConfirmations = async (
	domiaKey: string | undefined,
	reply: FastifyReply,
) => {
	const identity = await resolveHostedIdentity(domiaKey, reply)
	if (!identity) return
	const response: GetConfirmationsResponseType = {
		confirmations: listPendingConfirmations(identity.domiaKey),
	}
	return response
}

export const handleSettleConfirmation = async (
	domiaKey: string | undefined,
	scope: string,
	body: unknown,
	reply: FastifyReply,
) => {
	const identity = await resolveHostedIdentity(domiaKey, reply)
	if (!identity) return
	const parsed = postConfirmationSettleBodySchema.safeParse(body)
	if (!parsed.success)
		return badRequest(reply, parsed.error, "Invalid settle body")
	const scoped = confirmationScope(identity.domiaKey, scope)
	const target = listPendingConfirmations(identity.domiaKey).find(
		(entry) => entry.scope === scope || entry.scope === scoped,
	)
	if (!target) return notFound(reply, `unknown confirmation scope: ${scope}`)
	const outcome = await settlePendingConfirmation(
		target.scope,
		parsed.data.decision,
	)
	httpServerLogger.info(
		`🔒 POST /confirmations settle "${parsed.data.decision}" on ${target.tool}`,
		{ domiaKey: identity.domiaKey, settled: outcome.settled },
	)
	const response: PostConfirmationSettleResponseType = {
		scope: target.scope,
		decision: parsed.data.decision,
		settled: outcome.settled,
		ran: outcome.ran === true,
		status: outcome.result?.status ?? null,
		text: outcome.result?.text ?? null,
	}
	return response
}
