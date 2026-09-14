import { domiaBusLogger } from "@/utils"
import type { DomiaType } from "@/modules/core"
import type { ReloadGateType } from "../types"

export const createReloadGate = (): ReloadGateType => {
	const gated = new Map<string, number>()
	const waiters = new Map<string, Set<() => void>>()

	const acquire = (domiaIds: string[]): (() => void) => {
		for (const id of domiaIds) gated.set(id, (gated.get(id) ?? 0) + 1)
		let released = false
		return () => {
			if (released) return
			released = true
			for (const id of domiaIds) {
				const remaining = (gated.get(id) ?? 1) - 1
				if (remaining > 0) {
					gated.set(id, remaining)
					continue
				}
				gated.delete(id)
				const pending = waiters.get(id)
				if (!pending) continue
				waiters.delete(id)
				for (const notify of pending) notify()
			}
		}
	}

	const isGated = (domiaId: string): boolean => (gated.get(domiaId) ?? 0) > 0

	const waitForRelease = (
		domiaId: string,
		timeoutMs: number,
	): Promise<boolean> => {
		if (!isGated(domiaId)) return Promise.resolve(true)
		return new Promise<boolean>((resolve) => {
			const pending = waiters.get(domiaId) ?? new Set<() => void>()
			waiters.set(domiaId, pending)
			const notify = (): void => {
				clearTimeout(timer)
				resolve(true)
			}
			const timer = setTimeout(() => {
				pending.delete(notify)
				resolve(false)
			}, timeoutMs)
			timer.unref()
			pending.add(notify)
		})
	}

	return { acquire, isGated, waitForRelease }
}

export const reloadGate = createReloadGate()

export const awaitReloadGate = async (domia: DomiaType): Promise<boolean> => {
	if (!reloadGate.isGated(domia.id)) return true
	domiaBusLogger.info("⏸️ interaction held — config reload in flight", {
		domiaId: domia.id,
		domiaKey: domia.domiaKey,
	})
	const released = await reloadGate.waitForRelease(
		domia.id,
		domia.configReloadDrainMs,
	)
	domiaBusLogger.info(
		released
			? "▶️ interaction released — config reload finished"
			: "⏱️ interaction refused — config reload still in flight after drain",
		{ domiaId: domia.id, domiaKey: domia.domiaKey },
	)
	return released
}
