import type { FastifyReply } from "fastify"
import type { ZodError } from "zod"

export const notFound = (reply: FastifyReply, message: string): FastifyReply =>
	reply.code(404).send({ error: message })

export const conflict = (reply: FastifyReply, message: string): FastifyReply =>
	reply.code(409).send({ error: message })

export const badRequest = (
	reply: FastifyReply,
	error: ZodError,
	message = "Invalid request body",
): FastifyReply =>
	reply.code(400).send({
		error: message,
		issues: error.issues.map((issue) =>
			issue.path.length
				? `${issue.path.join(".")}: ${issue.message}`
				: issue.message,
		),
	})
