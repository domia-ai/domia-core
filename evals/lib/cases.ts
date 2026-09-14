import { z } from "zod"

import { SUPPORTED_LANGUAGES } from "@/utils/language-catalogs"

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

const mockMusicStateSchema = z
	.object({
		player: z.string().min(1),
		state: z.enum(["idle", "playing", "paused"]).optional(),
		volumeLevel: z.number().int().min(0).max(100).optional(),
		muted: z.boolean().optional(),
		currentItemMatches: z.string().min(1).optional(),
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
		tools: z.array(z.string()).optional(),
		toolsNamespaced: z.array(z.string()).optional(),
		mockMusicState: mockMusicStateSchema.optional(),
		noTools: z.boolean().optional(),
		noWrites: z.boolean().optional(),
		compound: z.number().int().positive().optional(),
		replyNotQuestion: z.boolean().optional(),
		replyMatches: z.string().min(1).optional(),
		replyNotMatches: z.string().min(1).optional(),
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

const mockHaSchema = z
	.object({
		latencyMs: z.record(z.string(), z.number()).optional(),
		fail: z
			.record(z.string(), z.union([z.number(), z.literal("always")]))
			.optional(),
		poison: z.record(z.string(), z.string()).optional(),
		annotations: z.boolean().optional(),
		catalogSize: z.number().int().nonnegative().optional(),
		domainPrefixed: z.boolean().optional(),
		stateful: z.boolean().optional(),
	})
	.strict()

const mockMusicSchema = z
	.object({
		latencyMs: z.record(z.string(), z.number()).optional(),
		fail: z
			.record(z.string(), z.union([z.number(), z.literal("always")]))
			.optional(),
		poison: z.record(z.string(), z.string()).optional(),
		stateful: z.boolean().optional(),
	})
	.strict()

const onReplyWhenSchema = z
	.object({
		toolCalled: z.string().min(1).optional(),
		notToolCalled: z.string().min(1).optional(),
		replyMatches: z.string().min(1).optional(),
		routed: z.enum(["skill", "chat", "fast"]).optional(),
		traceToolStatus: z.record(z.string(), z.string()).optional(),
	})
	.strict()

const onReplySchema = z
	.object({ when: onReplyWhenSchema, next: z.string().min(1) })
	.strict()

const conversationSchema = z
	.object({
		judge: z
			.object({ rubric: z.string().min(1), min: z.number().min(1).max(5) })
			.strict()
			.optional(),
		minTurnPassRate: z.number().min(0).max(1).optional(),
		ttftP50MaxMs: z.number().positive().optional(),
		ttfaP50MaxMs: z.number().positive().optional(),
		perceivedTtfaP50MaxMs: z.number().positive().optional(),
		minToolCorrectness: z.number().min(0).max(1).optional(),
		minInstructionFollowing: z.number().min(0).max(1).optional(),
		minContextRetention: z.number().min(0).max(1).optional(),
	})
	.strict()

const turnSchema = z
	.object({
		id: z.string().min(1).optional(),
		name: z.string().min(1).optional(),
		gate: z.boolean().optional(),
		text: z.string().min(1),
		satelliteId: z.string().min(1).optional(),
		mockHa: mockHaSchema.optional(),
		onReply: z.array(onReplySchema).min(1).optional(),
		end: z.boolean().optional(),
		expect: expectSchema,
	})
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
			"conversation-long",
			"parsing",
			"tools",
			"tools-confirm",
			"security",
			"routing",
			"tool-scenarios",
		]),
		language: z.string().refine((code) => SUPPORTED_LANGUAGES.has(code)),
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
		mockHa: mockHaSchema.optional(),
		mockMusic: mockMusicSchema.optional(),
		site: z.string().min(1).optional(),
		entities: z.record(z.string(), z.string()).optional(),
		conversation: conversationSchema.optional(),
		turns: z.array(turnSchema).min(1),
	})
	.strict()

export const evalCaseFileSchema = z.array(evalCaseSchema)
