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

const promptSectionSchema = z
	.object({
		section: z.enum([
			"WHAT YOU KNOW",
			"WHAT YOU KNOW ABOUT HERE",
			"RECENT TURNS",
			"WHO YOU'RE TALKING TO",
			"PREVIOUSLY",
		]),
		includes: z.array(z.string()).min(1),
	})
	.strict()

const factRefSchema = z
	.object({ subject: z.string().optional(), value: z.string() })
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
		replyExcludes: z.array(z.string()).optional(),
		maxTtfaMs: z.number().positive().optional(),
		status: z.literal("ok").optional(),
		promptIncludes: z.array(z.string()).optional(),
		promptSection: promptSectionSchema.optional(),
		recallsFact: factRefSchema.optional(),
		factInDb: factRefSchema.optional(),
		noFactInDb: factRefSchema.optional(),
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
			"conversation",
			"parsing",
		]),
		language: z.enum(["en", "es"]),
		runs: z.number().int().positive().optional(),
		passRatio: z.number().min(0).max(1).optional(),
		mode: z.enum(["gate", "advisory"]).optional(),
		isolate: z.enum(["facts", "conversation"]).optional(),
		turns: z.array(turnSchema).min(1),
	})
	.strict()

export const evalCaseFileSchema = z.array(evalCaseSchema)
