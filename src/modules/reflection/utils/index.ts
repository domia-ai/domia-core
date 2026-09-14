import {
	DEFAULT_REFLECTION_CONCURRENCY,
	DEFAULT_REFLECTION_QUEUE_MAX_DEPTH,
} from "@/db"
import { createAsyncSemaphore, isSemaphoreBusyError } from "@/utils"

import {
	REFLECTION_PRIORITY_CONCURRENCY,
	REFLECTION_PRIORITY_QUEUE_MAX_DEPTH,
} from "../constants"
import type {
	ReflectionGateDepsType,
	ReflectionGateSettingsType,
	ReflectionGateType,
} from "../types"

const IDLE_REVALIDATE_MAX_ATTEMPTS = 3

export const createReflectionGate = (
	deps: ReflectionGateDepsType,
): ReflectionGateType => {
	const { activeVoiceReplies, sleep, now, logger } = deps
	const semaphores = new Map<string, ReturnType<typeof createAsyncSemaphore>>()
	const pendingByIdentity = new Map<string, number>()

	const semaphoreFor = (
		identityId: string,
	): ReturnType<typeof createAsyncSemaphore> => {
		const existing = semaphores.get(identityId)
		if (existing) return existing
		const fresh = createAsyncSemaphore(
			DEFAULT_REFLECTION_CONCURRENCY,
			DEFAULT_REFLECTION_QUEUE_MAX_DEPTH,
		)
		semaphores.set(identityId, fresh)
		return fresh
	}

	const waitForIdle = async (
		settings: ReflectionGateSettingsType,
	): Promise<boolean> => {
		if (!settings.onlyWhenIdle) return true
		if (activeVoiceReplies() > 0) {
			logger.info(
				"⏳ reflection yielding LLM to live rooms — waiting for hub idle",
				{ activeVoiceReplies: activeVoiceReplies() },
			)
		}
		const deadline = now() + settings.maxIdleWaitMs
		for (;;) {
			while (activeVoiceReplies() > 0) {
				if (now() >= deadline) return false
				await sleep(settings.idlePollMs)
			}
			// mid-conversation the next turn lands seconds after a reply — only reflect after a real pause
			const graceEnd = now() + settings.idleGraceMs
			let interrupted = false
			while (now() < graceEnd) {
				if (activeVoiceReplies() > 0) {
					interrupted = true
					break
				}
				if (now() >= deadline) return false
				await sleep(settings.idlePollMs)
			}
			if (!interrupted) return true
		}
	}

	const runGatedInner = async <T>(
		semaphore: ReturnType<typeof createAsyncSemaphore>,
		settings: ReflectionGateSettingsType,
		fn: () => Promise<T>,
		skipValue: T,
	): Promise<T> => {
		for (let attempt = 1; attempt <= IDLE_REVALIDATE_MAX_ATTEMPTS; attempt++) {
			const idle = await waitForIdle(settings)
			if (!idle) {
				logger.info(
					"reflection deferred while hub busy — skipping (best-effort)",
				)
				return skipValue
			}
			let release!: () => void
			try {
				release = await semaphore.acquire({
					timeoutMs: settings.slotTimeoutMs,
				})
			} catch (err) {
				if (isSemaphoreBusyError(err)) {
					logger.info("reflection gate full — skipping (best-effort)")
					return skipValue
				}
				throw err
			}
			try {
				if (settings.onlyWhenIdle && activeVoiceReplies() > 0) continue
				return await fn()
			} finally {
				release()
			}
		}
		logger.info(
			"reflection deferred after repeated busy revalidations — skipping (best-effort)",
		)
		return skipValue
	}

	const runGated = async <T>(
		identityId: string,
		settings: ReflectionGateSettingsType,
		fn: () => Promise<T>,
		skipValue: T,
		priority = false,
	): Promise<T> => {
		const lane = priority ? `${identityId}#priority` : identityId
		const concurrency = priority
			? REFLECTION_PRIORITY_CONCURRENCY
			: settings.concurrency
		const queueMaxDepth = priority
			? REFLECTION_PRIORITY_QUEUE_MAX_DEPTH
			: settings.queueMaxDepth
		const semaphore = semaphoreFor(lane)
		semaphore.setLimit(concurrency)
		semaphore.setMaxWaiters(queueMaxDepth)
		const pending = pendingByIdentity.get(lane) ?? 0
		if (pending >= concurrency + queueMaxDepth) {
			logger.info("reflection backlog full — skipping (best-effort)", {
				identityId,
				pending,
				priority,
			})
			return skipValue
		}
		pendingByIdentity.set(lane, pending + 1)
		try {
			return await runGatedInner(semaphore, settings, fn, skipValue)
		} finally {
			const current = pendingByIdentity.get(lane) ?? 1
			if (current <= 1) pendingByIdentity.delete(lane)
			else pendingByIdentity.set(lane, current - 1)
		}
	}

	return { waitForIdle, runGated }
}
