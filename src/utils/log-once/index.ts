import type { LoggerType } from "../logger"

export const createLogOnce = (logger: LoggerType) => {
	const seen = new Set<string>()
	const once =
		(level: "info" | "warn") =>
		(key: string, message: string, meta?: object): void => {
			if (seen.has(key)) return
			seen.add(key)
			logger[level](message, meta)
		}
	return { info: once("info"), warn: once("warn"), reset: () => seen.clear() }
}
