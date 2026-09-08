import { z } from "zod"

const portString = (def: string) =>
	z.string().regex(/^\d+$/, "must be a port number").default(def)

const blankToUndefined = (value: unknown): unknown =>
	typeof value === "string" && value.trim() === "" ? undefined : value

const optionalString = () =>
	z.preprocess(blankToUndefined, z.string().optional())

const optionalFlag = () =>
	z.preprocess(
		blankToUndefined,
		z
			.enum(["0", "1", "true", "false"])
			.optional()
			.transform((v) => v === "1" || v === "true"),
	)

const envSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	DATABASE_URL: z.string(),
	DEBUG: z.string().optional(),
	DOMIA_KEY: z.string(),
	DOMIA_MESH_SECRET: z.string().min(8),
	DOMIA_MESH_SECRET_NEXT: z.preprocess(
		blankToUndefined,
		z.string().min(8).optional(),
	),
	DB_STUDIO_PORT: portString("6789"),
	HTTP_SERVER_HOST: z.string().default("localhost"),
	HTTP_SERVER_PORT: portString("3000"),
	GRPC_HOST: z.string().default("127.0.0.1"),
	GRPC_PORT: portString("5052"),
	MQTT_TOPIC_ROOT: z.string().default("domia"),
	DOMIA_LOG_FILE: z.string().optional(),
	DOMIA_LOG_FORMAT: z.enum(["json", "pretty"]).optional(),
	DOMIA_TLS_CERT_FILE: optionalString(),
	DOMIA_TLS_KEY_FILE: optionalString(),
	DOMIA_TLS_CA_FILE: optionalString(),
	DOMIA_TLS_REQUIRE_CLIENT_CERT: optionalFlag(),
	DOMIA_OTEL_EXPORTER_URL: z.preprocess(blankToUndefined, z.url().optional()),
	DOMIA_OTEL_SERVICE_NAME: z.string().default("domia-core"),
})

export const env = envSchema.parse(process.env)

export default env
