import type { FastifyReply } from "fastify"

import { getDomia, getOwnDomia } from "@/modules/core"
import { getActiveTurn } from "@/modules/core-bus"
import { acquireBench, runBench } from "@/modules/bench"
import { httpServerLogger, setTraceContext } from "@/utils"
import { postBenchRunBodySchema } from "../schemas"
import { badRequest } from "../utils/http-errors"

export const handlePostBenchRun = async (
	domiaKey: string | undefined,
	body: unknown,
	reply: FastifyReply,
) => {
	if (!domiaKey) {
		return reply.code(400).send({ error: "missing domiaKey" })
	}
	const domia = await getDomia(domiaKey)
	if (!domia) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	if (!domia.isHosted) {
		return reply.code(409).send({ error: `not a hosted identity: ${domiaKey}` })
	}
	const parsed = postBenchRunBodySchema.safeParse(body ?? {})
	if (!parsed.success)
		return badRequest(reply, parsed.error, "Invalid bench body")
	const live = await getOwnDomia(domiaKey).catch((err: unknown) => {
		httpServerLogger.warn("identity lookup failed", { err, domiaKey })
		return null
	})
	if (!live) {
		return reply.code(404).send({ error: `unknown identity: ${domiaKey}` })
	}
	if (getActiveTurn(live.id)) {
		return reply.code(409).send({ error: "live turn in progress" })
	}
	const release = acquireBench()
	if (!release) {
		return reply.code(409).send({ error: "bench already running" })
	}
	setTraceContext({ originDomiaKey: domiaKey })
	try {
		return await runBench(live, parsed.data)
	} catch (err) {
		httpServerLogger.error("Bench run failed", { domiaKey, err })
		return await reply.code(500).send({ error: "Bench run failed" })
	} finally {
		release()
	}
}
