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

const sha256Hex = z
	.string()
	.regex(/^[A-Fa-f0-9]{64}$/, "must be a sha256 hex digest")

const sizeBytes = z.number().int().positive()

const license = z.string().min(1).max(200)

export const modelInstallSpecSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("sherpa-archive"),
		label: z.string().max(120).optional(),
		stage: z.string().max(40).optional(),
		license: license.optional(),
		url: httpUrl,
		subdir: safeName.optional(),
		target: safeName,
		sourceDir: safeName.optional(),
		sha256: sha256Hex.optional(),
		sizeBytes: sizeBytes.optional(),
	}),
	z.object({
		kind: z.literal("file"),
		label: z.string().max(120).optional(),
		stage: z.string().max(40).optional(),
		license: license.optional(),
		url: httpUrl,
		subdir: safeName.optional(),
		target: safeName,
		sha256: sha256Hex.optional(),
		sizeBytes: sizeBytes.optional(),
	}),
	z.object({
		kind: z.literal("ollama"),
		label: z.string().max(120).optional(),
		stage: z.string().max(40).optional(),
		license: license.optional(),
		model: ollamaName,
	}),
])
