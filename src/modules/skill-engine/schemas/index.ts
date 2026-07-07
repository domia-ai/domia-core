import { z } from "zod"

const finalizeRuleSchema = z
	.object({
		mode: z.enum(["agent_loop", "template", "async", "deadline"]),
		ack: z.string().optional(),
		error: z.string().optional(),
		done: z.string().optional(),
		ackAfterMs: z.number().finite().min(0).optional(),
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

const executionSchema = z
	.object({
		coreTools: z.array(z.string()).optional(),
		toolPolicy: z.record(z.string(), z.enum(["allow", "block"])).optional(),
		paramAllow: z.record(z.string(), z.array(z.string())).optional(),
		finalize: finalizeMapSchema.optional(),
		genericWords: z.array(z.string()).optional(),
	})
	.strict()

const localeSchema = routingSchema
	.extend({
		finalize: finalizeMapSchema.optional(),
		genericWords: z.array(z.string()).optional(),
	})
	.strict()

export const domiaSkillDescriptorSchema = z
	.object({
		version: z.literal(1),
		kind: z.string().optional(),
		description: z.string().optional(),
		routing: routingSchema.optional(),
		execution: executionSchema.optional(),
		i18n: z.record(z.string(), localeSchema).optional(),
	})
	.strict()
