import debug from "debug"

import { env } from "@/config"
import { colors } from "./constants"
import type { LogLevelType, LogPrefixType } from "./types"

const isDevelopment = env.NODE_ENV !== "production"

export const createLogger = (namespace: string) => {
	const debugInstance = debug(namespace)

	const getPrefix = (level: LogLevelType): LogPrefixType => {
		const prefix = `[${namespace}]`

		switch (level) {
			case "error":
				return { prefix, color: colors.error }
			case "warn":
				return { prefix, color: colors.warning }
			case "info":
				return { prefix, color: colors.info }
			case "debug":
				return { prefix, color: colors.debug }
			default:
				return { prefix, color: (text: string) => text }
		}
	}

	const formatMessage = (level: LogLevelType, message: string): string => {
		const { prefix, color } = getPrefix(level)
		return `${color(prefix)} ${message}`
	}

	const log = (
		level: LogLevelType,
		message: string,
		...args: unknown[]
	): void => {
		const timestamp = new Date().toISOString()
		const formattedMessage = formatMessage(level, message)

		if (isDevelopment) {
			debugInstance(formattedMessage, ...args)
		} else {
			const logMethod = {
				error: console.error,
				warn: console.warn,
				info: console.log,
				debug: console.log,
			}[level]

			logMethod(`[${timestamp}] ${formattedMessage}`, ...args)
		}
	}

	return {
		error: (message: string, ...args: unknown[]) =>
			log("error", message, ...args),
		warn: (message: string, ...args: unknown[]) =>
			log("warn", message, ...args),
		info: (message: string, ...args: unknown[]) =>
			log("info", message, ...args),
		debug: (message: string, ...args: unknown[]) => {
			if (isDevelopment) {
				log("debug", message, ...args)
			}
		},
		success: (message: string, ...args: unknown[]) => {
			console.log(colors.success("✓"), colors.highlight(message), ...args)
		},
	}
}

export const appLogger = createLogger("app")
export const errorLogger = createLogger("error")
export const dbLogger = createLogger("db")
export const emotionEngineLogger = createLogger("emotion-engine")
export const configEngineLogger = createLogger("config-engine")
export const audioCaptureLogger = createLogger("audio-capture")
export const domiaBusLogger = createLogger("domia-bus")
export const localMqttLogger = createLogger("local-mqtt")
export const remoteMqttLogger = createLogger("remote-mqtt")
export const sttEngineLogger = createLogger("stt-engine")
export const llmEngineLogger = createLogger("llm-engine")
export const ttsEngineLogger = createLogger("tts-engine")
export const audioPlaybackLogger = createLogger("audio-playback")
export const scriptsLogger = createLogger("scripts")
export const devCliLogger = createLogger("dev-cli")
