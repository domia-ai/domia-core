import { createChannel, createClient, type Channel } from "nice-grpc"

import { env } from "@/config"
import { grpcClientLogger } from "@/utils"
import {
	DomiaNodeDefinition,
	type DomiaNodeClient,
	type EventEnvelope,
	type AudioChunk,
	type TokenChunk,
	type ReplyAudioMessage,
} from "@/generated/proto/domia"
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
	DEFAULT_DEADLINE_MS,
	GRPC_UNAVAILABLE_CODE,
	GRPC_UNIMPLEMENTED_CODE,
	GRPC_RESOURCE_EXHAUSTED_CODE,
	RETRYABLE_GRPC_CODES,
	UNHEALTHY_GRPC_STATES,
	STREAM_IDLE_TIMEOUT_MS,
	STREAM_DEADLINE_MS,
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

const addrOf = (target: DeliverEventTarget): string =>
	`${target.localIp}:${target.grpcPort}`

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
		const timer = setTimeout(() => ac.abort(), STREAM_DEADLINE_MS)
		try {
			const request = (async function* (): AsyncIterable<AudioChunk> {
				yield {
					pcm: new Uint8Array(0),
					meta: {
						senderDomiaKey,
						originDomiaKey: meta.originDomiaKey,
						interactionId: meta.interactionId,
						responseType: meta.responseType,
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
	invoke: (client: DomiaNodeClient, signal: AbortSignal) => AsyncIterable<T>,
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
			timer = setTimeout(() => ac.abort(), STREAM_IDLE_TIMEOUT_MS)
		}
		resetIdle()
		const iterator = invoke(client, ac.signal)[Symbol.asyncIterator]()
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
	const opened = await openServerStream<TokenChunk>(targets, (client, signal) =>
		client.streamLlm(
			{
				senderDomiaKey,
				transcript: request.transcript,
				originDomiaKey: request.originDomiaKey,
				interactionId: request.interactionId,
				responseType: request.responseType,
				personaContextJson: request.personaContextJson,
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
	const opened = await openServerStream<AudioChunk>(targets, (client, signal) =>
		client.streamTts(
			{
				senderDomiaKey,
				reply: request.reply,
				originDomiaKey: request.originDomiaKey,
				interactionId: request.interactionId,
				ttsVoiceJson: request.ttsVoiceJson,
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
		(client, signal) =>
			client.streamReplyAudio(
				{
					senderDomiaKey,
					transcript: request.transcript,
					originDomiaKey: request.originDomiaKey,
					interactionId: request.interactionId,
					responseType: request.responseType,
					personaContextJson: request.personaContextJson,
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
		(client, signal) => {
			const audioRequest = (async function* (): AsyncIterable<AudioChunk> {
				yield {
					pcm: new Uint8Array(0),
					meta: {
						senderDomiaKey,
						originDomiaKey: request.originDomiaKey,
						interactionId: request.interactionId,
						responseType: request.responseType,
						personaContextJson: request.personaContextJson,
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
	const timer = setTimeout(() => ac.abort(), DEFAULT_DEADLINE_MS)
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

export const closeAllChannels = (): void => {
	for (const ch of channels.values()) ch.close()
	channels.clear()
	clients.clear()
}
