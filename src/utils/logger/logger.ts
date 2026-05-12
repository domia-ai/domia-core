import debug from "debug"

import { env } from "@/config"
import { colors } from "./constants"
import { getTraceContext } from "./context"
import type { LogLevelType, LogPrefixType } from "./types"

const isDevelopment = env.NODE_ENV !== "production"
const isJsonMode = process.env.DOMIA_LOG_FORMAT === "json"

export const createLogger = (namespace: string) => {
	const debugInstance = debug(`domia:${namespace}`)

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
			case "success":
				return { prefix, color: colors.success }
			default:
				return { prefix, color: (text: string) => text }
		}
	}

	const formatMessage = (level: LogLevelType, message: string): string => {
		const { prefix, color } = getPrefix(level)
		const trace = getTraceContext()
		const traceSuffix =
			trace && trace.interactionId ? ` [iid=${trace.interactionId}]` : ""
		return `${color(prefix)}${traceSuffix} ${message}`
	}

	const logJson = (
		level: LogLevelType,
		message: string,
		args: unknown[],
	): void => {
		const meta =
			args.length === 1 ? args[0] : args.length > 1 ? args : undefined
		const trace = getTraceContext()
		const entry = {
			ts: new Date().toISOString(),
			level,
			ns: namespace,
			msg: message,
			...(trace?.interactionId ? { interactionId: trace.interactionId } : {}),
			...(trace?.originDomiaKey
				? { originDomiaKey: trace.originDomiaKey }
				: {}),
			...(trace?.traceId ? { traceId: trace.traceId } : {}),
			...(meta && typeof meta === "object" ? meta : meta ? { meta } : {}),
		}
		const out = JSON.stringify(entry)
		if (level === "error") console.error(out)
		else if (level === "warn") console.warn(out)
		else console.log(out)
	}

	const log = (
		level: LogLevelType,
		message: string,
		...args: unknown[]
	): void => {
		if (isJsonMode) {
			logJson(level, message, args)
			return
		}
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
				success: console.log,
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
		success: (message: string, ...args: unknown[]) =>
			log("success", message, ...args),
	}
}

export const appLogger = createLogger("app")
export const errorLogger = createLogger("error")
export const dbLogger = createLogger("db")
export const emotionEngineLogger = createLogger("emotion-engine")
export const configEngineLogger = createLogger("config-engine")
export const audioCaptureLogger = createLogger("audio-capture")
export const domiaBusLogger = createLogger("core-bus")
export const mqttLogger = createLogger("mqtt")
export const localMqttLogger = createLogger("local-mqtt")
export const remoteMqttLogger = createLogger("remote-mqtt")
export const sttEngineLogger = createLogger("stt-engine")
export const llmEngineLogger = createLogger("llm-engine")
export const ttsEngineLogger = createLogger("tts-engine")
export const audioPlaybackLogger = createLogger("audio-playback")
export const scriptsLogger = createLogger("scripts")
export const devCliLogger = createLogger("dev-cli")
export const httpServerLogger = createLogger("http-server")
export const heartbeatLogger = createLogger("heartbeat")
export const networkSyncLogger = createLogger("network-sync")
export const promptContextBuilderLogger = createLogger("prompt-context-builder")
export const grpcServerLogger = createLogger("grpc-server")
export const grpcClientLogger = createLogger("grpc-client")
