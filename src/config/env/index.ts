import { z } from "zod"

const envSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	DATABASE_URL: z.string(),
	DEBUG: z.string().optional(),
	DOMIA_KEY: z.string(),
	DOMIA_TYPE: z.enum(["SMART", "DUMP"]).default("SMART"),
	PYTHON_BIN: z.string().default(".venv/bin/python3"),
	HTTP_SERVER_HOST: z.string().default("default"),
	HTTP_SERVER_PORT: z.string().default("3000"),
	DOMIA_ML_HOST: z.string().default("127.0.0.1"),
	DOMIA_ML_PORT: z.string().default("5051"),
	DOMIA_ML_READY_TIMEOUT_MS: z.string().default("30000"),
})

export const env = envSchema.parse(process.env)

export const PYTHON_BIN = env.PYTHON_BIN

export type Env = z.infer<typeof envSchema>

export default env
