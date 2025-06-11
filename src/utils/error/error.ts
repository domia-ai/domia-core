import { errorLogger, type LoggerType } from "@/utils"
import type { ErrorCodeType } from "./types"

export class DomiaError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly meta?: Record<string, unknown>,
	) {
		super(message)
		this.name = "DomiaError"
		Error.captureStackTrace?.(this, DomiaError)
	}
}

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
