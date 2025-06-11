import { z } from "zod"
import "dotenv/config"

const envSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	DATABASE_URL: z.string(),
	DEBUG: z.string().optional(),
	DOMIA_KEY: z.string(),
	PYTHON_BIN: z.string().default(".venv/bin/python3"),
})

export const env = envSchema.parse(process.env)

export const PYTHON_BIN = env.PYTHON_BIN

export type Env = z.infer<typeof envSchema>

export default env
