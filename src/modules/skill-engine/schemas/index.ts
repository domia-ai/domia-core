import { z } from "zod"

import {
	ARG_NORMALIZE_OP_ENUM_VALUES,
	MCP_PROTOCOL_MODE_ENUM_VALUES,
	DEFAULT_MCP_PROTOCOL_MODE,
} from "@/db"

const finalizeRuleSchema = z
	.object({
		mode: z.enum(["agent_loop", "template", "async", "deadline"]),
		ack: z.string().optional(),
		error: z.string().optional(),
		done: z.string().optional(),
		ackAfterMs: z.number().min(0).optional(),
	})
	.strict()

const finalizeMapSchema = z.record(z.string(), finalizeRuleSchema)

const routingSchema = z
	.object({
		aliases: z.record(z.string(), z.array(z.string())).optional(),
		exampleUtterances: z.array(z.string()).optional(),
		keywords: z.array(z.string()).optional(),
	})
	.strict()

const resilienceSchema = z
	.object({
		retryMaxAttempts: z.number().int().min(1).optional(),
		retryBackoffMs: z.number().int().min(0).optional(),
		breakerThreshold: z.number().int().min(0).optional(),
		breakerCooldownMs: z.number().int().min(0).optional(),
		idempotentWithinTurn: z.boolean().optional(),
		serveStaleTools: z.boolean().optional(),
	})
	.strict()

const toolHintSchema = z
	.object({
		readOnlyHint: z.boolean().optional(),
		destructiveHint: z.boolean().optional(),
		idempotentHint: z.boolean().optional(),
		openWorldHint: z.boolean().optional(),
		timeoutMs: z.number().int().min(0).optional(),
		cancellable: z.boolean().optional(),
	})
	.strict()

const argNormalizeSchema = z.record(
	z.string(),
	z.record(z.string(), z.array(z.enum(ARG_NORMALIZE_OP_ENUM_VALUES))),
)

const executionSchema = z
	.object({
		coreTools: z.array(z.string()).optional(),
		toolPolicy: z
			.record(z.string(), z.enum(["allow", "block", "confirm"]))
			.optional(),
		toolHints: z.record(z.string(), toolHintSchema).optional(),
		paramAllow: z.record(z.string(), z.array(z.string())).optional(),
		argNormalize: argNormalizeSchema.optional(),
		finalize: finalizeMapSchema.optional(),
		genericWords: z.array(z.string()).optional(),
		resilience: resilienceSchema.optional(),
	})
	.strict()

const fastPathSlotSourceSchema = z.union([
	z.object({ kind: z.literal("context"), key: z.string().min(1) }).strict(),
	z
		.object({ kind: z.literal("enum"), values: z.array(z.string()).min(1) })
		.strict(),
	z.object({ kind: z.literal("schemaEnum"), arg: z.string().min(1) }).strict(),
	z
		.object({ kind: z.literal("range"), min: z.number(), max: z.number() })
		.strict(),
])

const fastPathSlotSchema = z
	.object({
		source: fastPathSlotSourceSchema,
		arg: z.string().optional(),
	})
	.strict()

const fastPathIntentSchema = z
	.object({
		tool: z.string().min(1),
		templates: z.array(z.string().min(1)).min(1),
		slots: z.record(z.string(), fastPathSlotSchema).optional(),
		requiredKeywords: z.array(z.array(z.string().min(1)).min(1)).optional(),
		argDefaults: z.record(z.string(), z.unknown()).optional(),
	})
	.strict()

const fastPathBlockSchema = z
	.object({
		intents: z.array(fastPathIntentSchema),
		expansionRules: z.record(z.string(), z.string()).optional(),
	})
	.strict()

const localeSchema = routingSchema
	.extend({
		finalize: finalizeMapSchema.optional(),
		genericWords: z.array(z.string()).optional(),
		fastPath: fastPathBlockSchema.optional(),
	})
	.strict()

const elicitContentValueSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.array(z.string()),
])

export const skillProviderProtocolSchema = z.object({
	protocolMode: z
		.enum(MCP_PROTOCOL_MODE_ENUM_VALUES)
		.catch(DEFAULT_MCP_PROTOCOL_MODE),
})

export const skillElicitResultSchema = z.discriminatedUnion("action", [
	z
		.object({
			action: z.literal("accept"),
			content: z.record(z.string(), elicitContentValueSchema),
		})
		.strict(),
	z.object({ action: z.literal("decline") }).strict(),
	z.object({ action: z.literal("cancel") }).strict(),
])

export const domiaSkillDescriptorSchema = z
	.object({
		version: z.literal(1),
		kind: z.string().optional(),
		description: z.string().optional(),
		routing: routingSchema.optional(),
		execution: executionSchema.optional(),
		fastPath: fastPathBlockSchema.optional(),
		i18n: z.record(z.string(), localeSchema).optional(),
	})
	.strict()
