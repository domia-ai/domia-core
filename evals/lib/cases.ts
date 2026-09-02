import { z } from "zod"

const expectEventsSchema = z
	.object({
		present: z.array(z.string()).optional(),
		toolResultStatus: z
			.enum(["ok", "failed", "timeout", "cancelled"])
			.optional(),
		toolResultStatusFor: z
			.record(z.string(), z.enum(["ok", "failed", "timeout", "cancelled"]))
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
		noRepeat: z.boolean().optional(),
		noEcho: z.boolean().optional(),
		maxReplyWords: z.number().int().positive().optional(),
		judge: z
			.object({ rubric: z.string().min(1), min: z.number().min(1).max(5) })
			.strict()
			.optional(),
		maxTtfaMs: z.number().positive().optional(),
		status: z.literal("ok").optional(),
		promptIncludes: z.array(z.string()).optional(),
		promptSection: promptSectionSchema.optional(),
		recallsFact: factRefSchema.optional(),
		factInDb: factRefSchema.optional(),
		noFactInDb: factRefSchema.optional(),
		factCountAtMost: factRefSchema
			.extend({ count: z.number().int().positive() })
			.optional(),
		fastPath: z.boolean().optional(),
		calledToolCount: z.number().int().nonnegative().optional(),
		traceToolStatus: z.record(z.string(), z.string()).optional(),
		exactlyOnce: z.string().optional(),
		stageOrder: z.array(z.string()).min(2).optional(),
		maxDecisionMs: z.number().positive().optional(),
		maxToolMs: z.number().positive().optional(),
		maxFinalizeMs: z.number().positive().optional(),
		expectFinalizeMode: z.string().optional(),
		expectStopReason: z.string().optional(),
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
			"tools",
			"tools-confirm",
			"security",
			"routing",
		]),
		language: z.enum(["en", "es"]),
		runs: z.number().int().positive().optional(),
		passRatio: z.number().min(0).max(1).optional(),
		mode: z.enum(["gate", "advisory"]).optional(),
		isolate: z.enum(["facts", "conversation", "session"]).optional(),
		seedFacts: z
			.array(
				z
					.object({
						subject: z.string().min(1),
						relation: z.string().min(1),
						value: z.string().min(1),
					})
					.strict(),
			)
			.optional(),
		mockHa: z
			.object({
				latencyMs: z.record(z.string(), z.number()).optional(),
				fail: z
					.record(z.string(), z.union([z.number(), z.literal("always")]))
					.optional(),
				poison: z.record(z.string(), z.string()).optional(),
				annotations: z.boolean().optional(),
				catalogSize: z.number().int().nonnegative().optional(),
			})
			.strict()
			.optional(),
		turns: z.array(turnSchema).min(1),
	})
	.strict()

export const evalCaseFileSchema = z.array(evalCaseSchema)
