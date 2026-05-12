import { z } from "zod"

const envSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	DATABASE_URL: z.string(),
	DEBUG: z.string().optional(),
	DOMIA_KEY: z.string(),
	DOMIA_TYPE: z.enum(["SMART", "DUMP"]).default("SMART"),
	HTTP_SERVER_HOST: z.string().default("default"),
	HTTP_SERVER_PORT: z.string().default("3000"),
	GRPC_HOST: z.string().default("127.0.0.1"),
	GRPC_PORT: z.string().default("5052"),
	GRPC_DEADLINE_MS: z.string().default("10000"),
	GRPC_STREAM_IDLE_MS: z.string().default("30000"),
})

export const env = envSchema.parse(process.env)

export type Env = z.infer<typeof envSchema>

export default env
