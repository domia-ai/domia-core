import { errorLogger, type LoggerType } from "@/utils"
import type { ErrorCodeType } from "./types"

const DOMIA_ERROR_MARKER = Symbol.for("domia.error")

export class DomiaError extends Error {
	readonly [DOMIA_ERROR_MARKER] = true

	constructor(
		public readonly code: string,
		message: string,
		public readonly meta?: Record<string, unknown>,
	) {
		super(message)
		this.name = "DomiaError"
		Error.captureStackTrace?.(this, DomiaError)
	}

	static isInstance(value: unknown): value is DomiaError {
		return (
			typeof value === "object" &&
			value !== null &&
			(value as Record<symbol, unknown>)[DOMIA_ERROR_MARKER] === true
		)
	}
}

export const isDomiaError = (value: unknown): value is DomiaError =>
	DomiaError.isInstance(value)

export const hasErrorCode = (
	value: unknown,
	prefix: string,
): value is DomiaError =>
	DomiaError.isInstance(value) && value.code.startsWith(prefix)

export const getErrorMessage = (error: ErrorCodeType) => {
	return `[${error?.code}] ${error?.message}`
}

export const domiaError = (
	error: ErrorCodeType,
	options?: {
		meta?: Record<string, unknown>
		logger?: LoggerType
		messageOverride?: string
	},
) => {
	const logger = options?.logger ?? errorLogger
	const message = options?.messageOverride ?? error.message
	logger.error(`[${error.code}] ${message}`, options?.meta)
	return new DomiaError(error.code, message, options?.meta)
}

export const toError = (value: unknown): Error => {
	if (value instanceof Error) return value
	if (typeof value === "string") return new Error(value)
	return new Error(String(value))
}

export const serializeFatal = (reason: unknown) => ({
	message: reason instanceof Error ? reason.message : String(reason),
	stack:
		reason instanceof Error
			? reason.stack?.split("\n").slice(1, 4).join(" | ")
			: undefined,
	...(typeof reason === "object" && reason !== null ? reason : {}),
})
