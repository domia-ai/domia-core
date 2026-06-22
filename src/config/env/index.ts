import { z } from "zod"

const envSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	DATABASE_URL: z.string(),
	DEBUG: z.string().optional(),
	DOMIA_KEY: z.string(),
	DB_STUDIO_PORT: z.string().default("6789"),
	HTTP_SERVER_HOST: z.string().default("localhost"),
	HTTP_SERVER_PORT: z.string().default("3000"),
	GRPC_HOST: z.string().default("127.0.0.1"),
	GRPC_PORT: z.string().default("5052"),
	MQTT_TOPIC_ROOT: z.string().default("domia"),
	DOMIA_LOG_FILE: z.string().optional(),
})

export const env = envSchema.parse(process.env)

export type Env = z.infer<typeof envSchema>

export default env
