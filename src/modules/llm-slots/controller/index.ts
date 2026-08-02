import { LLM_ENGINE_ENUM } from "@/db"
import type { DomiaType } from "@/modules/core"
import { llmSlotsLogger, sleep } from "@/utils"

import type {
	LlmSlotPurposeType,
	SlotLeaseType,
	SlotServerStateType,
	SlotStatsType,
} from "../types"

const SLOT_WAIT_TIMEOUT_MS = 8000
const SLOT_WAIT_POLL_MS = 25
const LEASE_MAX_HOLD_MS = 120_000
const DEGRADED_RETRY_MS = 30_000

const servers = new Map<string, SlotServerStateType>()
const discovering = new Map<string, Promise<SlotServerStateType>>()
let generationCounter = 0
const stats: SlotStatsType = {
	waits: 0,
	waitTimeouts: 0,
	reassignments: 0,
	invalidations: 0,
	degradedSessions: 0,
	backgroundOnSharedSlot: 0,
}

const affinityApplies = (domia: DomiaType): boolean =>
	domia.llmModelConfig?.slotAffinityEnabled === true &&
	domia.llmModelConfig?.engine === LLM_ENGINE_ENUM.OPENAI_COMPATIBLE &&
	!!domia.llmModelConfig?.baseUrl?.trim()

const baseUrlOf = (domia: DomiaType): string =>
	domia.llmModelConfig?.baseUrl?.trim() ?? ""

const serverSlotIdle = async (
	baseUrl: string,
	slotId: number,
): Promise<boolean> => {
	try {
		const res = await fetch(`${baseUrl.replace(/\/v1\/?$/, "")}/slots`, {
			signal: AbortSignal.timeout(1500),
		})
		if (!res.ok) return false
		const slots = (await res.json()) as {
			id?: number
			is_processing?: boolean
		}[]
		const slot = slots.find((entry) => entry.id === slotId)
		return slot !== undefined && slot.is_processing !== true
	} catch {
		return false
	}
}

const propsUrl = (baseUrl: string): string =>
	`${baseUrl.replace(/\/v1\/?$/, "")}/props`

const discover = (baseUrl: string): Promise<SlotServerStateType> => {
	const existing = servers.get(baseUrl)
	if (existing) {
		const retryDue =
			existing.degraded &&
			existing.degradedAt !== null &&
			Date.now() - existing.degradedAt >= DEGRADED_RETRY_MS
		if (!retryDue) return Promise.resolve(existing)
		servers.delete(baseUrl)
	}
	const inFlightDiscovery = discovering.get(baseUrl)
	if (inFlightDiscovery) return inFlightDiscovery
	const promise = (async (): Promise<SlotServerStateType> => {
		const state: SlotServerStateType = {
			generation: ++generationCounter,
			slots: 0,
			leases: new Map(),
			lruOrder: [],
			inFlight: [],
			lastAcquireAt: [],
			leaseGeneration: [],
			degraded: false,
			degradedAt: null,
		}
		try {
			const res = await fetch(propsUrl(baseUrl), {
				signal: AbortSignal.timeout(3000),
			})
			if (!res.ok) throw new Error(`props ${res.status}`)
			const props = (await res.json()) as { total_slots?: number }
			const slots = props.total_slots ?? 0
			if (slots < 1) throw new Error(`total_slots=${slots}`)
			state.slots = slots
			state.inFlight = new Array<number>(slots).fill(0)
			state.lastAcquireAt = new Array<number>(slots).fill(0)
			state.leaseGeneration = new Array<number>(slots).fill(0)
			llmSlotsLogger.info(
				`🎰 slot discovery: ${slots} slots (gen ${state.generation})`,
				{ baseUrl },
			)
		} catch (err) {
			state.degraded = true
			state.degradedAt = Date.now()
			stats.degradedSessions += 1
			llmSlotsLogger.warn(
				"⚠️ slot discovery failed — affinity degraded off for this server",
				{ baseUrl, err },
			)
		}
		servers.set(baseUrl, state)
		return state
	})()
	discovering.set(baseUrl, promise)
	void promise.finally(() => discovering.delete(baseUrl))
	return promise
}

const interactiveSlotCount = (state: SlotServerStateType): number =>
	state.slots >= 2 ? state.slots - 1 : state.slots

const touchLru = (state: SlotServerStateType, identityId: string): void => {
	const idx = state.lruOrder.indexOf(identityId)
	if (idx >= 0) state.lruOrder.splice(idx, 1)
	state.lruOrder.push(identityId)
}

const slotFor = (
	state: SlotServerStateType,
	identityId: string,
	purpose: LlmSlotPurposeType,
): number | null => {
	if (purpose === "background" && state.slots >= 2) return state.slots - 1
	if (purpose === "background") stats.backgroundOnSharedSlot += 1
	const existing = state.leases.get(identityId)
	if (existing !== undefined) {
		touchLru(state, identityId)
		return existing
	}
	const usable = interactiveSlotCount(state)
	const leased = new Set(state.leases.values())
	for (let slot = 0; slot < usable; slot++) {
		if (!leased.has(slot)) {
			state.leases.set(identityId, slot)
			touchLru(state, identityId)
			return slot
		}
	}
	for (const lruId of state.lruOrder) {
		const slot = state.leases.get(lruId)
		if (slot === undefined || lruId === identityId) continue
		if (state.inFlight[slot] === 0) {
			state.leases.delete(lruId)
			state.leases.set(identityId, slot)
			touchLru(state, identityId)
			stats.reassignments += 1
			llmSlotsLogger.info(`🎰 slot ${slot} reassigned ${lruId} → ${identityId}`)
			return slot
		}
	}
	return null
}

const makeLease = (
	state: SlotServerStateType,
	slotId: number,
): SlotLeaseType => {
	state.inFlight[slotId] += 1
	state.lastAcquireAt[slotId] = Date.now()
	const generation = state.leaseGeneration[slotId]
	let released = false
	return {
		slotId,
		release: () => {
			if (released) return
			released = true
			if (
				slotId >= 0 &&
				slotId < state.inFlight.length &&
				state.leaseGeneration[slotId] === generation
			)
				state.inFlight[slotId] = Math.max(0, state.inFlight[slotId] - 1)
		},
	}
}

export const acquireSlotLease = async (
	domia: DomiaType,
	purpose: LlmSlotPurposeType,
): Promise<SlotLeaseType | null> => {
	if (!affinityApplies(domia)) return null
	const baseUrl = baseUrlOf(domia)
	const deadline = Date.now() + SLOT_WAIT_TIMEOUT_MS
	let waited = false
	let state = await discover(baseUrl)
	for (;;) {
		if (state.degraded || state.slots < 1) return null
		if (servers.get(baseUrl) !== state) {
			state = await discover(baseUrl)
			continue
		}
		const slotId = slotFor(state, domia.id, purpose)
		if (slotId !== null) {
			// same-identity serialization: an occupied lease means an in-flight request on this exact slot
			if (state.inFlight[slotId] === 0) return makeLease(state, slotId)
		}
		if (
			slotId !== null &&
			state.inFlight[slotId] > 0 &&
			Date.now() - (state.lastAcquireAt[slotId] ?? 0) > LEASE_MAX_HOLD_MS
		) {
			const idleOnServer = await serverSlotIdle(baseUrl, slotId)
			if (idleOnServer) {
				llmSlotsLogger.warn(
					"⚠️ stale lease force-released (server confirms slot idle)",
					{
						slotId,
						heldMs: Date.now() - (state.lastAcquireAt[slotId] ?? 0),
					},
				)
				state.inFlight[slotId] = 0
				state.leaseGeneration[slotId] += 1
				continue
			}
			llmSlotsLogger.warn(
				"⚠️ lease past ceiling but server still processing — failing waiter",
				{ slotId },
			)
			stats.waitTimeouts += 1
			throw new Error("llm slot wait timed out (lease held, server busy)")
		}
		if (!waited) {
			waited = true
			stats.waits += 1
		}
		if (Date.now() >= deadline) {
			stats.waitTimeouts += 1
			llmSlotsLogger.warn("⚠️ slot wait timed out", {
				identityId: domia.id,
				purpose,
			})
			throw new Error("llm slot wait timed out (slot leased and busy)")
		}
		await sleep(SLOT_WAIT_POLL_MS)
	}
}

export const isIdentitySlotBusy = (domia: DomiaType): boolean => {
	if (!affinityApplies(domia)) return false
	const state = servers.get(baseUrlOf(domia))
	if (!state || state.degraded) return false
	const slot = state.leases.get(domia.id)
	if (slot === undefined) return false
	return (state.inFlight[slot] ?? 0) > 0
}

export const invalidateSlots = (domia: DomiaType): void => {
	const baseUrl = baseUrlOf(domia)
	if (!servers.has(baseUrl)) return
	servers.delete(baseUrl)
	stats.invalidations += 1
	llmSlotsLogger.warn(
		"🎰 slot table invalidated (server error/restart) — rediscovering on next request",
		{ baseUrl },
	)
}

export const slotStats = (): SlotStatsType => ({ ...stats })

export const resetSlotCoordinator = (): void => {
	servers.clear()
	discovering.clear()
}
