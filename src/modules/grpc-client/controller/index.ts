import { createChannel, createClient, type Channel } from "nice-grpc"

import { env } from "@/config"
import { grpcClientLogger } from "@/utils"
import {
	DomiaNodeDefinition,
	type DomiaNodeClient,
	type EventEnvelope,
} from "@/generated/proto/domia"
import type {
	DeliverEventTarget,
	DeliverEventPayloadMap,
	DeliverEventResult,
} from "../types"
import {
	DEFAULT_DEADLINE_MS,
	GRPC_UNAVAILABLE_CODE,
	RETRYABLE_GRPC_CODES,
	UNHEALTHY_GRPC_STATES,
} from "../constants"

const channels = new Map<string, Channel>()
const clients = new Map<string, DomiaNodeClient>()

const closeChannel = (addr: string): void => {
	const channel = channels.get(addr)
	if (channel) {
		try {
			channel.close()
		} catch (err) {
			grpcClientLogger.warn(
				`channel.close() for ${addr} threw: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
	}
	channels.delete(addr)
	clients.delete(addr)
}

const createClientForAddr = (addr: string): DomiaNodeClient => {
	const channel = createChannel(addr)
	channels.set(addr, channel)
	const client = createClient(DomiaNodeDefinition, channel)
	clients.set(addr, client)
	return client
}

const isUnavailableError = (err: unknown): boolean => {
	if (!err || typeof err !== "object") return false
	const code = (err as { code?: number }).code
	return code === GRPC_UNAVAILABLE_CODE
}

const getClient = (target: DeliverEventTarget): DomiaNodeClient | null => {
	if (!target.localIp || !target.grpcPort) return null
	const addr = `${target.localIp}:${target.grpcPort}`
	const existing = channels.get(addr)
	if (existing) {
		const state = existing.getConnectivityState(false)
		if (UNHEALTHY_GRPC_STATES.has(state)) {
			grpcClientLogger.warn(
				`channel ${addr} unhealthy (state=${state}) — recreating`,
			)
			closeChannel(addr)
		}
	}
	const cached = clients.get(addr)
	if (cached) return cached
	return createClientForAddr(addr)
}

const buildEnvelope = <K extends keyof DeliverEventPayloadMap>(
	senderDomiaKey: string,
	kind: K,
	payload: DeliverEventPayloadMap[K],
): EventEnvelope => {
	switch (kind) {
		case "audioReady":
			return {
				senderDomiaKey,
				payload: {
					$case: "audioReady",
					audioReady: payload as DeliverEventPayloadMap["audioReady"],
				},
			}
		case "sttDone":
			return {
				senderDomiaKey,
				payload: {
					$case: "sttDone",
					sttDone: payload as DeliverEventPayloadMap["sttDone"],
				},
			}
		case "llmDone":
			return {
				senderDomiaKey,
				payload: {
					$case: "llmDone",
					llmDone: payload as DeliverEventPayloadMap["llmDone"],
				},
			}
		case "ttsDone":
			return {
				senderDomiaKey,
				payload: {
					$case: "ttsDone",
					ttsDone: payload as DeliverEventPayloadMap["ttsDone"],
				},
			}
		default:
			throw new Error(`buildEnvelope: unknown kind ${String(kind)}`)
	}
}

const isRetryable = (err: unknown): boolean => {
	if (!err || typeof err !== "object") return true
	const code = (err as { code?: number }).code
	if (typeof code === "number") return RETRYABLE_GRPC_CODES.has(code)
	return true
}

export const deliverEvent = async <K extends keyof DeliverEventPayloadMap>(
	senderDomiaKey: string,
	targets: DeliverEventTarget[],
	kind: K,
	payload: DeliverEventPayloadMap[K],
	deadlineMs: number = Number(env.GRPC_DEADLINE_MS) || DEFAULT_DEADLINE_MS,
): Promise<DeliverEventResult> => {
	if (targets.length === 0) {
		return {
			delivered: false,
			deduplicated: false,
			error: "no targets",
			attemptedTargets: 0,
		}
	}

	const envelope = buildEnvelope(senderDomiaKey, kind, payload)
	let attempted = 0

	for (const target of targets) {
		attempted++
		const client = getClient(target)
		if (!client) {
			grpcClientLogger.warn(
				`target ${target.domiaKey} missing localIp or grpcPort — skipping`,
			)
			continue
		}
		const addr = `${target.localIp}:${target.grpcPort}`
		try {
			const ac = new AbortController()
			const timer = setTimeout(() => ac.abort(), deadlineMs)
			let ack
			try {
				ack = await client.deliverEvent(envelope, { signal: ac.signal })
			} finally {
				clearTimeout(timer)
			}
			if (ack.accepted) {
				grpcClientLogger.info(
					`✓ ${kind} delivered to ${target.domiaKey} @ ${addr}${ack.deduplicated ? " (dedup)" : ""}`,
				)
				return {
					delivered: true,
					deduplicated: ack.deduplicated,
					target,
					attemptedTargets: attempted,
				}
			}
			grpcClientLogger.warn(
				`✗ ${target.domiaKey} rejected: ${ack.reason} — falling over`,
			)
		} catch (err) {
			grpcClientLogger.warn(
				`✗ ${kind} to ${target.domiaKey} @ ${addr} failed: ${err instanceof Error ? err.message : String(err)}`,
			)
			if (isUnavailableError(err)) {
				closeChannel(addr)
			}
			if (!isRetryable(err)) {
				return {
					delivered: false,
					deduplicated: false,
					target,
					error: String(err),
					attemptedTargets: attempted,
				}
			}
		}
	}

	return {
		delivered: false,
		deduplicated: false,
		error: "all targets failed",
		attemptedTargets: attempted,
	}
}

export const closeAllChannels = (): void => {
	for (const ch of channels.values()) ch.close()
	channels.clear()
	clients.clear()
}
