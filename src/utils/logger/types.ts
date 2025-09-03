import { createLogger } from "./logger"

export type LogLevelType = "error" | "warn" | "info" | "debug" | "success"

export type LoggerType = ReturnType<typeof createLogger>

export type LogPrefixType = {
	prefix: string
	color: (text: string) => string
}
