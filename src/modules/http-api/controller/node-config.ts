import { ZodError } from "zod"
import type { FastifyReply } from "fastify"

import {
	applyNodeConfig,
	loadNodeConfig,
	type NodeConfigApplyResultType,
	type NodeConfigSnapshotType,
} from "@/modules/node-config"
import { httpServerLogger } from "@/utils"

import { badRequest } from "../utils/http-errors"

export const handleGetNodeConfig = (): Promise<NodeConfigSnapshotType> =>
	loadNodeConfig()

export const handlePostNodeConfig = async (
	body: unknown,
	reply: FastifyReply,
): Promise<NodeConfigApplyResultType | FastifyReply> => {
	try {
		return await applyNodeConfig(body)
	} catch (err) {
		httpServerLogger.error("Node config apply failed", { err })
		if (err instanceof ZodError)
			return badRequest(reply, err, "Invalid node config bundle")
		return reply.code(500).send({ error: "Node config apply failed" })
	}
}
