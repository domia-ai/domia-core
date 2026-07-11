import {
	createChannel,
	createClientFactory,
	Metadata,
	type Channel,
} from "nice-grpc"

import { grpcClientLogger, meshBearerHeader } from "@/utils"
import { env } from "@/config"
import { isHostedIdentity } from "@/modules/core"
import {
	DomiaNodeDefinition,
	type DomiaNodeClient,
	type DomiaNodeServiceImplementation,
	type EventEnvelope,
	type AudioChunk,
	type TokenChunk,
	type ReplyAudioMessage,
	type StageMetric,
} from "@/generated/proto/domia"
import type {
	ChatMessageType,
	ToolCallType,
	ToolCallOrReplyType,
	ToolDefinitionType,
} from "@/modules/llm-engine"
import type {
	DeliverEventTarget,
	DeliverEventPayloadMap,
	DeliverEventResult,
	StreamSttMetaType,
	StreamSttResult,
	StreamLlmRequestType,
	StreamLlmResult,
	StreamTtsRequestType,
	StreamTtsResult,
	StreamReplyAudioRequestType,
	StreamReplyAudioResult,
	StreamVoiceReplyRequestType,
	StreamVoiceReplyResult,
	OpenedServerStream,
} from "../types"
import {
	GRPC_MAX_MESSAGE_BYTES,
	GRPC_UNAVAILABLE_CODE,
	GRPC_UNIMPLEMENTED_CODE,
	GRPC_RESOURCE_EXHAUSTED_CODE,
	RETRYABLE_GRPC_CODES,
	UNHEALTHY_GRPC_STATES,
} from "../constants"
import {
	DEFAULT_GRPC_UNARY_DEADLINE_MS,
	DEFAULT_GRPC_STREAM_IDLE_TIMEOUT_MS,
	DEFAULT_GRPC_STREAM_DEADLINE_MS,
} from "@/db"

const tunables = {
	unaryDeadlineMs: DEFAULT_GRPC_UNARY_DEADLINE_MS,
	streamIdleTimeoutMs: DEFAULT_GRPC_STREAM_IDLE_TIMEOUT_MS,
	streamDeadlineMs: DEFAULT_GRPC_STREAM_DEADLINE_MS,
}

export const setGrpcClientTunables = (domia: {
	grpcUnaryDeadlineMs: number
	grpcStreamIdleTimeoutMs: number
	grpcStreamDeadlineMs: number
}): void => {
	tunables.unaryDeadlineMs = domia.grpcUnaryDeadlineMs
	tunables.streamIdleTimeoutMs = domia.grpcStreamIdleTimeoutMs
	tunables.streamDeadlineMs = domia.grpcStreamDeadlineMs
}

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

const meshClientFactory = createClientFactory().use(
	async function* (call, options) {
		const metadata = Metadata(options.metadata ?? {}).set(
			"authorization",
			meshBearerHeader().authorization,
		)
		return yield* call.next(call.request, { ...options, metadata })
	},
)

const createClientForAddr = (addr: string): DomiaNodeClient => {
	const channel = createChannel(addr, undefined, {
		"grpc.max_receive_message_length": GRPC_MAX_MESSAGE_BYTES,
		"grpc.max_send_message_length": GRPC_MAX_MESSAGE_BYTES,
	})
	channels.set(addr, channel)
	const client = meshClientFactory.create(DomiaNodeDefinition, channel)
	clients.set(addr, client)
	return client
}

const isUnavailableError = (err: unknown): boolean => {
	if (!err || typeof err !== "object") return false
	const code = (err as { code?: number }).code
	return code === GRPC_UNAVAILABLE_CODE
}

const lastAddrByKey = new Map<string, string>()

let localClient: DomiaNodeClient | null = null

const abortableLocalStream = <T>(
	source: AsyncIterable<T>,
	signal?: AbortSignal,
): AsyncIterable<T> => {
	if (!signal) return source
	return (async function* (): AsyncIterable<T> {
		const iterator = source[Symbol.asyncIterator]()
		const onAbort = () => void iterator.return?.()
		signal.addEventListener("abort", onAbort)
		try {
			if (signal.aborted) return
			while (true) {
				const next = await iterator.next()
				if (next.done || signal.aborted) break
				yield next.value
			}
		} finally {
			signal.removeEventListener("abort", onAbort)
		}
	})()
}

const abortableLocalUnary = <T>(
	promise: Promise<T>,
	signal?: AbortSignal,
): Promise<T> => {
	if (!signal) return promise
	if (signal.aborted) return Promise.reject(new Error("local call aborted"))
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(new Error("local call aborted"))
		signal.addEventListener("abort", onAbort, { once: true })
		promise
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", onAbort))
	})
}

export const setLocalService = (impl: DomiaNodeServiceImplementation): void => {
	localClient = new Proxy({} as DomiaNodeClient, {
		get(_t, prop) {
			const method = (impl as unknown as Record<string | symbol, unknown>)[prop]
			if (typeof method !== "function") return undefined
			return (request: unknown, opts?: { signal?: AbortSignal }) => {
				const result = (
					method as (req: unknown, ctx?: unknown) => unknown
				).call(impl, request, {})
				if (
					result &&
					typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
						"function"
				) {
					return abortableLocalStream(
						result as AsyncIterable<unknown>,
						opts?.signal,
					)
				}
				if (result && typeof (result as Promise<unknown>).then === "function") {
					return abortableLocalUnary(result as Promise<unknown>, opts?.signal)
				}
				return result
			}
		},
	})
}

const resolveTargetAddr = (target: DeliverEventTarget): string | null => {
	if (isHostedIdentity(target.domiaKey)) return `127.0.0.1:${env.GRPC_PORT}`
	if (!target.localIp || !target.grpcPort) return null
	return `${target.localIp}:${target.grpcPort}`
}

const getClient = (target: DeliverEventTarget): DomiaNodeClient | null => {
	if (localClient && isHostedIdentity(target.domiaKey)) {
		grpcClientLogger.debug(`🔁 in-process dispatch → ${target.domiaKey}`)
		return localClient
	}
	const addr = resolveTargetAddr(target)
	if (!addr) return null
	const previous = lastAddrByKey.get(target.domiaKey)
	if (previous && previous !== addr) closeChannel(previous)
	lastAddrByKey.set(target.domiaKey, addr)
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
		case "interactionFailed":
			return {
				senderDomiaKey,
				payload: {
					$case: "interactionFailed",
					interactionFailed:
						payload as DeliverEventPayloadMap["interactionFailed"],
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
	deadlineMs?: number,
): Promise<DeliverEventResult> => {
	const effectiveDeadlineMs = deadlineMs ?? tunables.unaryDeadlineMs
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
		envelope.targetDomiaKey = target.domiaKey
		const addr = addrOf(target)
		try {
			const ac = new AbortController()
			const timer = setTimeout(() => ac.abort(), effectiveDeadlineMs)
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

const addrOf = (target: DeliverEventTarget): string =>
	resolveTargetAddr(target) ?? `${target.localIp}:${target.grpcPort}`

const errMsg = (err: unknown): string =>
	err instanceof Error ? err.message : String(err)

const isUnimplementedError = (err: unknown): boolean => {
	if (!err || typeof err !== "object") return false
	return (err as { code?: number }).code === GRPC_UNIMPLEMENTED_CODE
}

const isResourceExhaustedError = (err: unknown): boolean => {
	if (!err || typeof err !== "object") return false
	return (err as { code?: number }).code === GRPC_RESOURCE_EXHAUSTED_CODE
}

export const streamSttToTarget = async (
	senderDomiaKey: string,
	targets: DeliverEventTarget[],
	meta: StreamSttMetaType,
	audioFactory: () => AsyncIterable<Buffer>,
): Promise<StreamSttResult> => {
	if (targets.length === 0) {
		return { delivered: false, error: "no targets", attemptedTargets: 0 }
	}
	let attempted = 0
	let allUnsupported = true
	for (const target of targets) {
		attempted++
		const client = getClient(target)
		if (!client) {
			allUnsupported = false
			continue
		}
		const addr = addrOf(target)
		const ac = new AbortController()
		const timer = setTimeout(() => ac.abort(), tunables.streamDeadlineMs)
		try {
			const request = (async function* (): AsyncIterable<AudioChunk> {
				yield {
					pcm: new Uint8Array(0),
					meta: {
						senderDomiaKey,
						originDomiaKey: meta.originDomiaKey,
						interactionId: meta.interactionId,
						responseType: meta.responseType,
						targetDomiaKey: target.domiaKey,
					},
				}
				for await (const buf of audioFactory()) {
					yield { pcm: buf }
				}
			})()
			const ack = await client.streamStt(request, { signal: ac.signal })
			grpcClientLogger.info(
				`✓ streamStt → ${target.domiaKey} @ ${addr}: "${ack.transcript}"`,
			)
			return {
				delivered: true,
				transcript: ack.transcript,
				interactionId: ack.interactionId,
				originDomiaKey: ack.originDomiaKey,
				responseType: ack.responseType,
				target,
				attemptedTargets: attempted,
			}
		} catch (err) {
			if (!isUnimplementedError(err)) allUnsupported = false
			if (isUnavailableError(err)) closeChannel(addr)
			grpcClientLogger.warn(
				`✗ streamStt to ${target.domiaKey} @ ${addr} failed: ${errMsg(err)}`,
			)
		} finally {
			clearTimeout(timer)
		}
	}
	return {
		delivered: false,
		unsupported: allUnsupported,
		error: "all targets failed",
		attemptedTargets: attempted,
	}
}

const openServerStream = async <T>(
	targets: DeliverEventTarget[],
	invoke: (
		client: DomiaNodeClient,
		signal: AbortSignal,
		target: DeliverEventTarget,
	) => AsyncIterable<T>,
): Promise<OpenedServerStream<T>> => {
	if (targets.length === 0) {
		return { delivered: false, error: "no targets", attemptedTargets: 0 }
	}
	let attempted = 0
	let allUnsupported = true
	let atCapacity = false
	for (const target of targets) {
		attempted++
		const client = getClient(target)
		if (!client) {
			allUnsupported = false
			continue
		}
		const addr = addrOf(target)
		const ac = new AbortController()
		let timer: ReturnType<typeof setTimeout> | undefined
		const resetIdle = () => {
			clearTimeout(timer)
			timer = setTimeout(() => ac.abort(), tunables.streamIdleTimeoutMs)
		}
		resetIdle()
		const iterator = invoke(client, ac.signal, target)[Symbol.asyncIterator]()
		let first: IteratorResult<T>
		try {
			first = await iterator.next()
		} catch (err) {
			clearTimeout(timer)
			if (!isUnimplementedError(err)) allUnsupported = false
			if (isUnavailableError(err)) closeChannel(addr)
			if (isResourceExhaustedError(err)) atCapacity = true
			grpcClientLogger.warn(
				`✗ stream open to ${target.domiaKey} @ ${addr} failed: ${errMsg(err)}`,
			)
			continue
		}
		const stream = (async function* (): AsyncIterable<T> {
			try {
				if (!first.done) {
					resetIdle()
					yield first.value
				}
				while (true) {
					const next = await iterator.next()
					if (next.done) break
					resetIdle()
					yield next.value
				}
			} finally {
				clearTimeout(timer)
				ac.abort()
				await iterator.return?.().catch(() => undefined)
			}
		})()
		return {
			delivered: true,
			target,
			attemptedTargets: attempted,
			firstValue: first.done ? undefined : first.value,
			stream,
		}
	}
	return {
		delivered: false,
		unsupported: allUnsupported,
		atCapacity,
		error: atCapacity ? "hub at capacity" : "all targets failed",
		attemptedTargets: attempted,
	}
}

export const streamLlmFromTarget = async (
	senderDomiaKey: string,
	targets: DeliverEventTarget[],
	request: StreamLlmRequestType,
): Promise<StreamLlmResult> => {
	const opened = await openServerStream<TokenChunk>(
		targets,
		(client, signal, target) =>
			client.streamLlm(
				{
					senderDomiaKey,
					transcript: request.transcript,
					originDomiaKey: request.originDomiaKey,
					interactionId: request.interactionId,
					responseType: request.responseType,
					personaContextJson: request.persona
						? JSON.stringify(request.persona)
						: undefined,
					targetDomiaKey: target.domiaKey,
				},
				{ signal },
			),
	)
	if (!opened.delivered || !opened.stream) {
		return {
			delivered: false,
			unsupported: opened.unsupported,
			error: opened.error,
			attemptedTargets: opened.attemptedTargets,
		}
	}
	const sourceStream = opened.stream
	const tokens = (async function* (): AsyncIterable<string> {
		for await (const chunk of sourceStream) yield chunk.token
	})()
	return {
		delivered: true,
		tokens,
		target: opened.target,
		attemptedTargets: opened.attemptedTargets,
	}
}

export const streamTtsFromTarget = async (
	senderDomiaKey: string,
	targets: DeliverEventTarget[],
	request: StreamTtsRequestType,
): Promise<StreamTtsResult> => {
	const opened = await openServerStream<AudioChunk>(
		targets,
		(client, signal, target) =>
			client.streamTts(
				{
					senderDomiaKey,
					reply: request.reply,
					originDomiaKey: request.originDomiaKey,
					interactionId: request.interactionId,
					ttsVoiceJson: request.ttsVoice
						? JSON.stringify(request.ttsVoice)
						: undefined,
					targetDomiaKey: target.domiaKey,
				},
				{ signal },
			),
	)
	if (!opened.delivered || !opened.stream) {
		return {
			delivered: false,
			unsupported: opened.unsupported,
			error: opened.error,
			attemptedTargets: opened.attemptedTargets,
		}
	}
	const sourceStream = opened.stream
	const audio = (async function* (): AsyncIterable<Buffer> {
		for await (const chunk of sourceStream) {
			if (chunk.pcm && chunk.pcm.length > 0) yield Buffer.from(chunk.pcm)
		}
	})()
	return {
		delivered: true,
		audio,
		sampleRate: opened.firstValue?.sampleRate,
		channels: opened.firstValue?.channels,
		target: opened.target,
		attemptedTargets: opened.attemptedTargets,
	}
}

export const streamReplyAudioFromTarget = async (
	senderDomiaKey: string,
	targets: DeliverEventTarget[],
	request: StreamReplyAudioRequestType,
): Promise<StreamReplyAudioResult> => {
	const opened = await openServerStream<ReplyAudioMessage>(
		targets,
		(client, signal, target) =>
			client.streamReplyAudio(
				{
					senderDomiaKey,
					transcript: request.transcript,
					originDomiaKey: request.originDomiaKey,
					interactionId: request.interactionId,
					responseType: request.responseType,
					personaContextJson: request.persona
						? JSON.stringify(request.persona)
						: undefined,
					targetDomiaKey: target.domiaKey,
				},
				{ signal },
			),
	)
	if (!opened.delivered || !opened.stream) {
		return {
			delivered: false,
			unsupported: opened.unsupported,
			atCapacity: opened.atCapacity,
			error: opened.error,
			attemptedTargets: opened.attemptedTargets,
		}
	}
	const sourceStream = opened.stream
	let resolveFinalReply!: (v: string) => void
	const finalReplyPromise = new Promise<string>((r) => {
		resolveFinalReply = r
	})
	let sampleRate: number | undefined
	let channels: number | undefined
	if (opened.firstValue?.payload?.$case === "audio") {
		sampleRate = opened.firstValue.payload.audio.sampleRate
		channels = opened.firstValue.payload.audio.channels
	}
	const audio = (async function* (): AsyncIterable<Buffer> {
		try {
			for await (const msg of sourceStream) {
				if (msg.payload?.$case === "audio") {
					const pcm = msg.payload.audio.pcm
					if (pcm && pcm.length > 0) yield Buffer.from(pcm)
				} else if (msg.payload?.$case === "finalReply") {
					resolveFinalReply(msg.payload.finalReply)
				}
			}
		} finally {
			resolveFinalReply("")
		}
	})()
	return {
		delivered: true,
		audio,
		finalReplyPromise,
		sampleRate,
		channels,
		target: opened.target,
		attemptedTargets: opened.attemptedTargets,
	}
}

export const streamVoiceReplyFromTarget = async (
	senderDomiaKey: string,
	targets: DeliverEventTarget[],
	request: StreamVoiceReplyRequestType,
): Promise<StreamVoiceReplyResult> => {
	const opened = await openServerStream<ReplyAudioMessage>(
		targets,
		(client, signal, target) => {
			const audioRequest = (async function* (): AsyncIterable<AudioChunk> {
				yield {
					pcm: new Uint8Array(0),
					meta: {
						senderDomiaKey,
						originDomiaKey: request.originDomiaKey,
						interactionId: request.interactionId,
						responseType: request.responseType,
						personaContextJson: request.persona
							? JSON.stringify(request.persona)
							: undefined,
						targetDomiaKey: target.domiaKey,
					},
				}
				for await (const buf of request.audioFactory()) {
					yield { pcm: buf }
				}
			})()
			return client.streamVoiceReply(audioRequest, { signal })
		},
	)
	if (!opened.delivered || !opened.stream) {
		return {
			delivered: false,
			unsupported: opened.unsupported,
			atCapacity: opened.atCapacity,
			error: opened.error,
			attemptedTargets: opened.attemptedTargets,
		}
	}
	const sourceStream = opened.stream
	let resolveTranscript!: (v: string) => void
	let resolveFinalReply!: (v: string) => void
	const transcriptPromise = new Promise<string>((r) => {
		resolveTranscript = r
	})
	const finalReplyPromise = new Promise<string>((r) => {
		resolveFinalReply = r
	})
	const audioMeta: { sampleRate?: number; channels?: number } = {}
	const audio = (async function* (): AsyncIterable<Buffer> {
		try {
			for await (const msg of sourceStream) {
				if (msg.payload?.$case === "audio") {
					const chunk = msg.payload.audio
					if (audioMeta.sampleRate === undefined)
						audioMeta.sampleRate = chunk.sampleRate
					if (audioMeta.channels === undefined)
						audioMeta.channels = chunk.channels
					if (chunk.pcm && chunk.pcm.length > 0) yield Buffer.from(chunk.pcm)
				} else if (msg.payload?.$case === "transcript") {
					resolveTranscript(msg.payload.transcript)
				} else if (msg.payload?.$case === "finalReply") {
					resolveFinalReply(msg.payload.finalReply)
				}
			}
		} finally {
			resolveTranscript("")
			resolveFinalReply("")
		}
	})()
	return {
		delivered: true,
		audio,
		transcriptPromise,
		finalReplyPromise,
		audioMeta,
		target: opened.target,
		attemptedTargets: opened.attemptedTargets,
	}
}

export const reportReflectionToTarget = async (
	senderDomiaKey: string,
	target: DeliverEventTarget,
	payload: {
		originDomiaKey?: string
		interactionId?: string
		emotionDeltaJson?: string
		cause?: string
		factsJson?: string
		userEmotionJson?: string
	},
): Promise<boolean> => {
	const client = getClient(target)
	if (!client) return false
	const addr = addrOf(target)
	const ac = new AbortController()
	const timer = setTimeout(() => ac.abort(), tunables.unaryDeadlineMs)
	try {
		const ack = await client.reportReflection(
			{
				senderDomiaKey,
				originDomiaKey: payload.originDomiaKey,
				interactionId: payload.interactionId,
				emotionDeltaJson: payload.emotionDeltaJson,
				cause: payload.cause,
				factsJson: payload.factsJson,
				userEmotionJson: payload.userEmotionJson,
			},
			{ signal: ac.signal },
		)
		return ack.accepted
	} catch (err) {
		if (isUnavailableError(err)) closeChannel(addr)
		grpcClientLogger.warn(
			`✗ reportReflection to ${target.domiaKey} @ ${addr} failed: ${errMsg(err)}`,
		)
		return false
	} finally {
		clearTimeout(timer)
	}
}

export const reportStageExecutionToTarget = async (
	senderDomiaKey: string,
	target: DeliverEventTarget,
	payload: {
		originDomiaKey?: string
		interactionId?: string
		stages: StageMetric[]
	},
): Promise<boolean> => {
	const client = getClient(target)
	if (!client) return false
	const addr = addrOf(target)
	const ac = new AbortController()
	const timer = setTimeout(() => ac.abort(), tunables.unaryDeadlineMs)
	try {
		const ack = await client.reportStageExecution(
			{
				senderDomiaKey,
				originDomiaKey: payload.originDomiaKey,
				interactionId: payload.interactionId,
				stages: payload.stages,
			},
			{ signal: ac.signal },
		)
		return ack.accepted
	} catch (err) {
		if (isUnavailableError(err)) closeChannel(addr)
		grpcClientLogger.warn(
			`✗ reportStageExecution to ${target.domiaKey} @ ${addr} failed: ${errMsg(err)}`,
		)
		return false
	} finally {
		clearTimeout(timer)
	}
}

export const delegateInferenceWithTools = async (
	senderDomiaKey: string,
	target: DeliverEventTarget,
	payload: {
		messages: ChatMessageType[]
		tools: ToolDefinitionType[]
		originDomiaKey?: string
		interactionId?: string
		sessionId?: string
	},
): Promise<ToolCallOrReplyType> => {
	const client = getClient(target)
	if (!client) throw new Error(`no grpc client for ${target.domiaKey}`)
	const addr = addrOf(target)
	const ac = new AbortController()
	const timer = setTimeout(() => ac.abort(), tunables.unaryDeadlineMs)
	try {
		const res = await client.runInferenceWithTools(
			{
				senderDomiaKey,
				messagesJson: JSON.stringify(payload.messages),
				toolsJson: JSON.stringify(payload.tools),
				originDomiaKey: payload.originDomiaKey,
				interactionId: payload.interactionId,
				sessionId: payload.sessionId,
				targetDomiaKey: target.domiaKey,
			},
			{ signal: ac.signal },
		)
		if (res.toolCallsJson) {
			return {
				kind: "tool_calls",
				calls: JSON.parse(res.toolCallsJson) as ToolCallType[],
			}
		}
		return { kind: "reply", text: res.reply ?? "" }
	} catch (err) {
		if (isUnavailableError(err)) closeChannel(addr)
		grpcClientLogger.warn(
			`✗ runInferenceWithTools to ${target.domiaKey} @ ${addr} failed: ${errMsg(err)}`,
		)
		throw err
	} finally {
		clearTimeout(timer)
	}
}

export const closeAllChannels = (): void => {
	for (const ch of channels.values()) ch.close()
	channels.clear()
	clients.clear()
}
