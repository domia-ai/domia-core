import OpenAI from "openai"

import { DomiaType } from "@/modules/core"
import {
	acquireSlotLease,
	invalidateSlots,
	type LlmSlotPurposeType,
} from "@/modules/llm-slots"
import { llmEngineLogger, createAsyncSemaphore } from "@/utils"
import { LLM_ERRORS, AGENT_ERRORS, domiaError, isDomiaError } from "@/utils"
import { DEFAULT_LLM_CONCURRENCY } from "@/db"
import type { OpenAiResolvedConfigType } from "./types"
import {
	LLAMA_PROPS_FAILURE_TTL_MS,
	LLAMA_PROPS_PATH,
	LLAMA_PROPS_TIMEOUT_MS,
} from "./constants"

const NO_AUTH = "noauth"

const llmSemaphore = createAsyncSemaphore(1)
const clients = new Map<string, OpenAI>()
const llamaServers = new Map<string, boolean>()
const llamaDetectionFailures = new Map<string, number>()

export const clearOpenAiClients = (): void => {
	clients.clear()
	llamaServers.clear()
	llamaDetectionFailures.clear()
}

export const llamaServerUrl = (baseURL: string, path: string): string =>
	`${baseURL.replace(/\/+$/, "").replace(/\/v1$/, "")}${path}`

const probeLlamaServer = async (baseURL: string): Promise<boolean> => {
	const response = await fetch(llamaServerUrl(baseURL, LLAMA_PROPS_PATH), {
		signal: AbortSignal.timeout(LLAMA_PROPS_TIMEOUT_MS),
	})
	if (!response.ok) return false
	const body: unknown = await response.json()
	return Boolean(body) && typeof body === "object"
}

export const isLlamaServer = async (
	cfg: OpenAiResolvedConfigType,
): Promise<boolean> => {
	const cached = llamaServers.get(cfg.baseURL)
	if (cached !== undefined) return cached
	const failedAt = llamaDetectionFailures.get(cfg.baseURL)
	if (
		failedAt !== undefined &&
		Date.now() - failedAt < LLAMA_PROPS_FAILURE_TTL_MS
	)
		return false
	try {
		const detected = await probeLlamaServer(cfg.baseURL)
		llamaServers.set(cfg.baseURL, detected)
		llamaDetectionFailures.delete(cfg.baseURL)
		llmEngineLogger.info("llama-server grammar mode detection", {
			baseURL: cfg.baseURL,
			detected,
		})
		return detected
	} catch (error) {
		llamaDetectionFailures.set(cfg.baseURL, Date.now())
		llmEngineLogger.warn("llama-server detection failed — retrying after TTL", {
			baseURL: cfg.baseURL,
			retryAfterMs: LLAMA_PROPS_FAILURE_TTL_MS,
			error,
		})
		return false
	}
}

export const acquireSlot = async (
	domia: DomiaType,
	purpose: LlmSlotPurposeType = "interactive",
	label = "unlabeled",
): Promise<{ release: () => void; slotId: number | null }> => {
	llmSemaphore.setLimit(
		domia.llmModelConfig?.llmConcurrency ?? DEFAULT_LLM_CONCURRENCY,
	)
	const releaseSemaphore = await llmSemaphore.acquire()
	let lease: { slotId: number; release: () => void } | null = null
	try {
		lease = await acquireSlotLease(domia, purpose)
	} catch (error) {
		releaseSemaphore()
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: { error, reason: "slot lease acquisition" },
		})
	}
	llmEngineLogger.debug("llm slot acquired", {
		label,
		purpose,
		slotId: lease?.slotId ?? null,
	})
	let released = false
	return {
		slotId: lease?.slotId ?? null,
		release: () => {
			if (released) return
			released = true
			lease?.release()
			releaseSemaphore()
		},
	}
}

export const slotBody = (slotId: number | null): { id_slot?: number } =>
	slotId !== null ? { id_slot: slotId } : {}

const CONNECTION_ERROR_RE =
	/ECONNREFUSED|ECONNRESET|fetch failed|connection error|APIConnectionError|socket hang up/i

const GRAMMAR_REJECTION_RE = /peg-native format|does not match the expected/i

const UNPARSED_OUTPUT_KEYS = [
	"output",
	"raw_output",
	"unparsed",
	"generated",
] as const

const errorPayloadOf = (error: unknown): Record<string, unknown> => {
	const err = error as { error?: unknown } | null
	return err?.error && typeof err.error === "object"
		? (err.error as Record<string, unknown>)
		: {}
}

const isGrammarRejection = (error: unknown): boolean => {
	const err = error as { status?: number; message?: string } | null
	if (typeof err?.status === "number" && err.status < 500) return false
	const payload = errorPayloadOf(error)
	const text = `${err?.message ?? ""} ${typeof payload.message === "string" ? payload.message : ""}`
	return GRAMMAR_REJECTION_RE.test(text)
}

const unparsedModelOutput = (error: unknown): string | undefined => {
	const payload = errorPayloadOf(error)
	for (const key of UNPARSED_OUTPUT_KEYS) {
		const value = payload[key]
		if (typeof value === "string" && value.length > 0) return value
	}
	return undefined
}

export const decisionEngineError = (error: unknown): Error =>
	isDomiaError(error)
		? error
		: isGrammarRejection(error)
			? domiaError(AGENT_ERRORS.DECISION_UNPARSEABLE, {
					logger: llmEngineLogger,
					messageOverride:
						"The server rejected the model's tool-call output against its grammar.",
					meta: {
						error,
						modelOutput: unparsedModelOutput(error),
					},
				})
			: domiaError(LLM_ERRORS.ENGINE_FAILED, {
					logger: llmEngineLogger,
					meta: { error },
				})

export const maybeInvalidateSlots = (
	domia: DomiaType,
	error: unknown,
): void => {
	const err = error as Error & { cause?: Error }
	const text = `${err.constructor.name} ${err.name} ${err.message} ${err.cause?.message ?? ""}`
	if (CONNECTION_ERROR_RE.test(text)) invalidateSlots(domia)
}

export const requireModel = (domia: DomiaType): string => {
	const modelName = domia.llmModelConfig?.modelName
	if (!modelName) {
		throw domiaError(LLM_ERRORS.MODEL_NOT_FOUND, {
			logger: llmEngineLogger,
			meta: { domiaId: domia.id },
		})
	}
	return modelName
}

export const resolveConfig = (domia: DomiaType): OpenAiResolvedConfigType => {
	const config = domia.llmModelConfig
	const baseURL = config?.baseUrl.trim()
	if (!baseURL) {
		throw domiaError(LLM_ERRORS.ENGINE_FAILED, {
			logger: llmEngineLogger,
			meta: {
				domiaId: domia.id,
				reason: "openai-compatible engine requires llmModelConfig.baseUrl",
			},
		})
	}
	return {
		baseURL,
		apiKey: config?.apiKey?.trim() || NO_AUTH,
		temperature: config?.temperature,
		maxTokens: config?.numPredict,
	}
}

export const getClient = (cfg: OpenAiResolvedConfigType): OpenAI => {
	const key = `${cfg.baseURL}|${cfg.apiKey}`
	const existing = clients.get(key)
	if (existing) return existing
	const client = new OpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey })
	clients.set(key, client)
	return client
}
