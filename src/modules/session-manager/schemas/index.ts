import { z } from "zod"

export const sessionSummarySchema = z.object({
	summary: z.string().optional(),
	moodArc: z.string().optional(),
	topics: z.array(z.string()).optional(),
	userSummary: z.string().optional(),
	moodTendencies: z.string().optional(),
	interests: z.array(z.string()).optional(),
})
