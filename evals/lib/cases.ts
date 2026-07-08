import { z } from "zod"

const expectEventsSchema = z
	.object({
		present: z.array(z.string()).optional(),
		toolResultStatus: z
			.enum(["ok", "failed", "timeout", "cancelled"])
			.optional(),
		completedAfterPlayback: z.boolean().optional(),
		seqOrdered: z.boolean().optional(),
	})
	.strict()

const expectSchema = z
	.object({
		routed: z.enum(["skill", "chat", "fast"]).optional(),
		tool: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
		notTools: z.array(z.string()).optional(),
		argsSubset: z.record(z.string(), z.unknown()).optional(),
		argMatchers: z.record(z.string(), z.string()).optional(),
		anyArgMatches: z.string().optional(),
		replyIncludes: z.array(z.string()).optional(),
		maxTtfaMs: z.number().positive().optional(),
		status: z.literal("ok").optional(),
		expectEvents: expectEventsSchema.optional(),
	})
	.strict()

const turnSchema = z
	.object({ text: z.string().min(1), expect: expectSchema })
	.strict()

export const evalCaseSchema = z
	.object({
		name: z.string().min(1),
		suite: z.enum([
			"home-mock",
			"home-live",
			"chat",
			"fast",
			"memory",
			"parsing",
		]),
		language: z.enum(["en", "es"]),
		runs: z.number().int().positive().optional(),
		passRatio: z.number().min(0).max(1).optional(),
		mode: z.enum(["gate", "advisory"]).optional(),
		isolate: z.literal("facts").optional(),
		turns: z.array(turnSchema).min(1),
	})
	.strict()

export const evalCaseFileSchema = z.array(evalCaseSchema)
