import fs from "fs"
import path from "path"

import debug from "debug"

import { env } from "@/config"
import { colors } from "./constants"
import { getTraceContext } from "./context"
import type { LogLevelType, LogPrefixType } from "./types"

const isDevelopment = env.NODE_ENV !== "production"
const isJsonMode = env.DOMIA_LOG_FORMAT === "json"

const MAX_LOG_BYTES = 10 * 1024 * 1024
const ROTATED_KEEP = 2

let fileStream: fs.WriteStream | null = null
let bytesWritten = 0

const openStream = (file: string): void => {
	fs.mkdirSync(path.dirname(file), { recursive: true })
	bytesWritten = fs.existsSync(file) ? fs.statSync(file).size : 0
	fileStream = fs.createWriteStream(file, { flags: "a" })
}

const getFileStream = (): fs.WriteStream | null => {
	if (!env.DOMIA_LOG_FILE) return null
	if (fileStream) return fileStream
	try {
		openStream(env.DOMIA_LOG_FILE)
		const close = () => {
			fileStream?.end()
			fileStream = null
		}
		process.once("exit", close)
		process.once("SIGINT", close)
		process.once("SIGTERM", close)
	} catch {
		fileStream = null
	}
	return fileStream
}

const rotateIfNeeded = (): void => {
	const file = env.DOMIA_LOG_FILE
	if (!file || bytesWritten < MAX_LOG_BYTES) return
	try {
		fileStream?.end()
		fileStream = null
		for (let i = ROTATED_KEEP - 1; i >= 1; i--) {
			const from = `${file}.${i}`
			const to = `${file}.${i + 1}`
			if (fs.existsSync(from)) fs.renameSync(from, to)
		}
		if (fs.existsSync(file)) fs.renameSync(file, `${file}.1`)
		openStream(file)
	} catch {
		fileStream = null
		bytesWritten = 0
	}
}

const buildJsonEntry = (
	namespace: string,
	level: LogLevelType,
	message: string,
	args: unknown[],
): Record<string, unknown> => {
	const meta = args.length === 1 ? args[0] : args.length > 1 ? args : undefined
	const trace = getTraceContext()
	return {
		ts: new Date().toISOString(),
		level,
		ns: namespace,
		msg: message,
		...(trace?.interactionId ? { interactionId: trace.interactionId } : {}),
		...(trace?.originDomiaKey ? { originDomiaKey: trace.originDomiaKey } : {}),
		...(trace?.traceId ? { traceId: trace.traceId } : {}),
		...(meta && typeof meta === "object" ? meta : meta ? { meta } : {}),
	}
}

const writeToFile = (entry: Record<string, unknown>): void => {
	const stream = getFileStream()
	if (!stream) return
	const line = JSON.stringify(entry) + "\n"
	try {
		stream.write(line)
		bytesWritten += Buffer.byteLength(line)
		rotateIfNeeded()
	} catch (err) {
		process.stderr.write(`[logger] file write failed: ${String(err)}\n`)
	}
}

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

	const log = (
		level: LogLevelType,
		message: string,
		...args: unknown[]
	): void => {
		const entry = buildJsonEntry(namespace, level, message, args)
		writeToFile(entry)

		if (isJsonMode) {
			const out = JSON.stringify(entry)
			if (level === "error") console.error(out)
			else if (level === "warn") console.warn(out)
			else console.log(out)
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
export const warmupLogger = createLogger("warmup")
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
export const mindLogger = createLogger("mind")
export const modelManagerLogger = createLogger("model-manager")
export const memoryLogger = createLogger("memory")
export const reflectionLogger = createLogger("reflection")
export const inferencePoolLogger = createLogger("inference-pool")
export const skillEngineLogger = createLogger("skill-engine")
export const intentRouterLogger = createLogger("intent-router")
export const embeddingsLogger = createLogger("embeddings")
export const matcherLogger = createLogger("matcher")
export const agentLogger = createLogger("agent")
export const satelliteGatewayLogger = createLogger("satellite-gateway")
export const satelliteWyomingLogger = createLogger("satellite-wyoming")
export const satelliteEsphomeLogger = createLogger("satellite-esphome")
export const satelliteLivekitLogger = createLogger("satellite-livekit")
export const realtimeGatewayLogger = createLogger("realtime-gateway")
export const satelliteDiscoveryLogger = createLogger("satellite-discovery")
export const turnEventsLogger = createLogger("turn-events")
