import { z } from "zod"

const portString = (def: string) =>
	z.string().regex(/^\d+$/, "must be a port number").default(def)

const envSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	DATABASE_URL: z.string(),
	DEBUG: z.string().optional(),
	DOMIA_KEY: z.string(),
	DOMIA_MESH_SECRET: z.string().min(8),
	DB_STUDIO_PORT: portString("6789"),
	HTTP_SERVER_HOST: z.string().default("localhost"),
	HTTP_SERVER_PORT: portString("3000"),
	GRPC_HOST: z.string().default("127.0.0.1"),
	GRPC_PORT: portString("5052"),
	MQTT_TOPIC_ROOT: z.string().default("domia"),
	DOMIA_LOG_FILE: z.string().optional(),
	DOMIA_LOG_FORMAT: z.enum(["json", "pretty"]).optional(),
})

export const env = envSchema.parse(process.env)

export type Env = z.infer<typeof envSchema>

export default env
