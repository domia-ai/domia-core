import type { FastifyReply } from "fastify"

import {
	meshSecretPosture,
	restartMeshSecretGrace,
	endMeshSecretGrace,
	isLoopbackAddress,
	isSigningMeshBearer,
	httpServerLogger,
} from "@/utils"
import { postMeshRotateBodySchema } from "../schemas"
import { badRequest } from "../utils/http-errors"
import type { PostMeshRotateResponseType } from "../types"

export const handlePostMeshRotate = async (
	body: unknown,
	authorization: string | undefined,
	remoteAddress: string | undefined,
	reply: FastifyReply,
): Promise<PostMeshRotateResponseType | FastifyReply> => {
	const parsed = postMeshRotateBodySchema.safeParse(body ?? {})
	if (!parsed.success) return badRequest(reply, parsed.error)
	const action = parsed.data.action
	if (
		action !== "status" &&
		!isLoopbackAddress(remoteAddress) &&
		!isSigningMeshBearer(authorization)
	)
		return reply.code(403).send({
			error: "mesh secret grace can only be mutated by the signing secret",
		})
	const posture =
		action === "restart-grace"
			? restartMeshSecretGrace()
			: action === "end-grace"
				? endMeshSecretGrace()
				: meshSecretPosture()
	if (action !== "status")
		httpServerLogger.warn(`🔑 mesh secret ${action} via /mesh/rotate`, {
			accepted: posture.accepted,
		})
	return { action, ...posture }
}
