import WebSocket from "ws"

import {
	DEFAULT_HA_WS_HANDSHAKE_TIMEOUT_MS,
	DEFAULT_HA_WS_AUTH_TIMEOUT_MS,
	DEFAULT_HA_WS_COMMAND_TIMEOUT_MS,
	DEFAULT_HA_WS_HEARTBEAT_INTERVAL_MS,
	DEFAULT_HA_WS_HEARTBEAT_TIMEOUT_MS,
	DEFAULT_HA_WS_RECONNECT_MS,
	DEFAULT_HA_WS_RECONNECT_MAX_MS,
	DEFAULT_HA_WS_RECONNECT_JITTER,
} from "@/db"
import { createReconnectScheduler } from "@/modules/satellite-core"

import type {
	HaWsClientOptionsType,
	HaWsClientType,
	HaWsStateType,
	HaWsSnapshotType,
	HaWsMessageType,
	HaStateObjectType,
	HaRegistryEntityType,
	HaRegistryAreaType,
	HaRegistryDeviceType,
} from "../../types"

import type { PendingCommandType } from "./types"

const asString = (v: unknown): string | null =>
	typeof v === "string" && v.trim() ? v : null

const parseEntityRegistry = (rows: unknown): HaRegistryEntityType[] =>
	(Array.isArray(rows) ? rows : []).flatMap((raw) => {
		const r = raw as Record<string, unknown>
		const entityId = asString(r.entity_id)
		if (!entityId) return []
		return [
			{
				entityId,
				name: asString(r.name),
				originalName: asString(r.original_name),
				aliases: Array.isArray(r.aliases)
					? r.aliases.filter((a): a is string => typeof a === "string")
					: [],
				areaId: asString(r.area_id),
				deviceId: asString(r.device_id),
				disabled: r.disabled_by != null,
				hidden: r.hidden_by != null,
			},
		]
	})

const parseAreaRegistry = (rows: unknown): HaRegistryAreaType[] =>
	(Array.isArray(rows) ? rows : []).flatMap((raw) => {
		const r = raw as Record<string, unknown>
		const areaId = asString(r.area_id)
		const name = asString(r.name)
		return areaId && name ? [{ areaId, name }] : []
	})

const parseDeviceRegistry = (rows: unknown): HaRegistryDeviceType[] =>
	(Array.isArray(rows) ? rows : []).flatMap((raw) => {
		const r = raw as Record<string, unknown>
		const deviceId = asString(r.id)
		return deviceId ? [{ deviceId, areaId: asString(r.area_id) }] : []
	})

const parseExposed = (result: unknown): Set<string> | null => {
	const exposed = (result as { exposed_entities?: unknown } | null)
		?.exposed_entities
	if (!exposed || typeof exposed !== "object") return null
	const ids = new Set<string>()
	for (const [entityId, targets] of Object.entries(
		exposed as Record<string, unknown>,
	)) {
		const t = targets as Record<string, unknown> | null
		if (t && Object.values(t).some((v) => v === true)) ids.add(entityId)
	}
	return ids.size > 0 ? ids : null
}

export const createHaWsClient = (
	opts: HaWsClientOptionsType,
): HaWsClientType => {
	let state: HaWsStateType = "idle"
	let ws: WebSocket | null = null
	let nextId = 1
	let subscriptionId: number | null = null
	let heartbeatInterval: ReturnType<typeof setInterval> | null = null
	let heartbeatTimeout: ReturnType<typeof setTimeout> | null = null
	let guardTimer: ReturnType<typeof setTimeout> | null = null
	const pending = new Map<number, PendingCommandType>()
	const scheduler = createReconnectScheduler(
		DEFAULT_HA_WS_RECONNECT_MS,
		DEFAULT_HA_WS_RECONNECT_MAX_MS,
		DEFAULT_HA_WS_RECONNECT_JITTER,
	)

	const setState = (next: HaWsStateType, reason?: string): void => {
		if (state === "closed") return
		state = next
		opts.onStatus(next, reason)
	}

	const clearTimers = (): void => {
		if (heartbeatInterval) clearInterval(heartbeatInterval)
		heartbeatInterval = null
		if (heartbeatTimeout) clearTimeout(heartbeatTimeout)
		heartbeatTimeout = null
		if (guardTimer) clearTimeout(guardTimer)
		guardTimer = null
		for (const p of pending.values()) {
			clearTimeout(p.timer)
			p.reject(new Error("connection dropped"))
		}
		pending.clear()
	}

	const discardSocket = (terminate: boolean): void => {
		if (!ws) return
		ws.removeAllListeners()
		ws.on("error", () => undefined)
		if (terminate) ws.terminate()
		else ws.close()
		ws = null
	}

	const dropAndRetry = (reason: string): void => {
		clearTimers()
		discardSocket(true)
		if (state === "closed") return
		setState("backoff", reason)
		scheduler.schedule(connect)
	}

	const send = (payload: Record<string, unknown>): Promise<unknown> => {
		const socket = ws
		if (!socket || socket.readyState !== WebSocket.OPEN)
			return Promise.reject(new Error("socket not open"))
		const id = nextId++
		socket.send(JSON.stringify({ id, ...payload }))
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id)
				reject(new Error(`command timeout: ${String(payload.type)}`))
			}, DEFAULT_HA_WS_COMMAND_TIMEOUT_MS)
			timer.unref()
			pending.set(id, { resolve, reject, timer })
		})
	}

	const startHeartbeat = (): void => {
		if (heartbeatInterval) return
		heartbeatInterval = setInterval(() => {
			heartbeatTimeout = setTimeout(() => {
				dropAndRetry("heartbeat timeout")
			}, DEFAULT_HA_WS_HEARTBEAT_TIMEOUT_MS)
			heartbeatTimeout.unref()
			send({ type: "ping" })
				.then(() => {
					if (heartbeatTimeout) clearTimeout(heartbeatTimeout)
					heartbeatTimeout = null
				})
				.catch(() => undefined)
		}, DEFAULT_HA_WS_HEARTBEAT_INTERVAL_MS)
		heartbeatInterval.unref()
	}

	const sync = async (): Promise<void> => {
		setState("syncing")
		const rawStates = await send({ type: "get_states" })
		const states: HaStateObjectType[] = Array.isArray(rawStates)
			? (rawStates as HaStateObjectType[])
			: []
		const entityRegistry = parseEntityRegistry(
			await send({ type: "config/entity_registry/list" }),
		)
		const areaRegistry = parseAreaRegistry(
			await send({ type: "config/area_registry/list" }),
		)
		const deviceRegistry = parseDeviceRegistry(
			await send({ type: "config/device_registry/list" }),
		)
		const exposedEntityIds = await send({
			type: "homeassistant/expose_entity/list",
		})
			.then(parseExposed)
			.catch(() => null)
		const snapshot: HaWsSnapshotType = {
			states,
			entityRegistry,
			areaRegistry,
			deviceRegistry,
			exposedEntityIds,
		}
		const sub = send({
			type: "subscribe_events",
			event_type: "state_changed",
		})
		subscriptionId = nextId - 1
		await sub
		scheduler.reset()
		setState("live")
		opts.onSync(snapshot)
	}

	const onMessage = (data: WebSocket.RawData): void => {
		let msg: HaWsMessageType
		try {
			msg = JSON.parse(data.toString()) as HaWsMessageType
		} catch {
			return
		}
		if (msg.type === "auth_required") {
			setState("authenticating")
			ws?.send(JSON.stringify({ type: "auth", access_token: opts.token }))
			return
		}
		if (msg.type === "auth_invalid") {
			clearTimers()
			discardSocket(true)
			scheduler.close()
			setState("closed", `auth rejected: ${String(msg.message ?? "")}`)
			return
		}
		if (msg.type === "auth_ok") {
			if (guardTimer) clearTimeout(guardTimer)
			guardTimer = null
			startHeartbeat()
			void sync().catch((err) =>
				dropAndRetry(`sync failed: ${String(err?.message ?? err)}`),
			)
			return
		}
		if (msg.type === "result" || msg.type === "pong") {
			const id = typeof msg.id === "number" ? msg.id : -1
			const p = pending.get(id)
			if (!p) return
			pending.delete(id)
			clearTimeout(p.timer)
			if (msg.type === "pong" || msg.success === true) p.resolve(msg.result)
			else p.reject(new Error(JSON.stringify(msg.error ?? "command failed")))
			return
		}
		if (msg.type === "event" && msg.id === subscriptionId) {
			const eventData = msg.event?.data
			const entityId = asString(eventData?.entity_id)
			if (!entityId) return
			opts.onEvent(entityId, eventData?.new_state ?? null)
		}
	}

	const connect = (): void => {
		if (state === "closed") return
		setState("connecting")
		ws = new WebSocket(opts.wsUrl, {
			handshakeTimeout: DEFAULT_HA_WS_HANDSHAKE_TIMEOUT_MS,
		})
		guardTimer = setTimeout(() => {
			dropAndRetry("auth handshake timeout")
		}, DEFAULT_HA_WS_AUTH_TIMEOUT_MS + DEFAULT_HA_WS_HANDSHAKE_TIMEOUT_MS)
		guardTimer.unref()
		ws.on("message", onMessage)
		ws.on("error", (err) => dropAndRetry(`socket error: ${err.message}`))
		ws.on("close", (code) => dropAndRetry(`socket closed (${code})`))
	}

	return {
		connect,
		close: () => {
			state = "closed"
			clearTimers()
			scheduler.close()
			discardSocket(false)
		},
		state: () => state,
	}
}
