import { z } from "zod"

const safeName = z
	.string()
	.min(1)
	.max(200)
	.regex(/^[A-Za-z0-9._-]+$/, "must be a plain name (no path separators)")

const ollamaName = z
	.string()
	.min(1)
	.max(200)
	.regex(/^[A-Za-z0-9._:/-]+$/, "invalid ollama model name")

const httpUrl = z.url().refine((u) => /^https?:\/\//.test(u), "must be http(s)")

export const modelInstallSpecSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("sherpa-archive"),
		label: z.string().max(120).optional(),
		stage: z.string().max(40).optional(),
		url: httpUrl,
		target: safeName,
		sourceDir: safeName.optional(),
	}),
	z.object({
		kind: z.literal("file"),
		label: z.string().max(120).optional(),
		stage: z.string().max(40).optional(),
		url: httpUrl,
		target: safeName,
	}),
	z.object({
		kind: z.literal("ollama"),
		label: z.string().max(120).optional(),
		stage: z.string().max(40).optional(),
		model: ollamaName,
	}),
])
