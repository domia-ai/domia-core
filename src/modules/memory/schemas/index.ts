import { z } from "zod"

export const factSchema = z.object({
	subject: z.string().min(1).max(60),
	relation: z.string().min(1).max(60),
	value: z.string().min(1).max(200),
	confidence: z.number().min(0).max(1).optional(),
	op: z.enum(["add", "delete"]).optional(),
})

export const factsArraySchema = z.array(factSchema)
