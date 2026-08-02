export type LlmSlotPurposeType = "interactive" | "background"

export type SlotServerStateType = {
	generation: number
	slots: number
	leases: Map<string, number>
	lruOrder: string[]
	inFlight: number[]
	lastAcquireAt: number[]
	leaseGeneration: number[]
	degraded: boolean
	degradedAt: number | null
}

export type SlotLeaseType = {
	slotId: number
	release: () => void
}

export type SlotStatsType = {
	waits: number
	waitTimeouts: number
	reassignments: number
	invalidations: number
	degradedSessions: number
	backgroundOnSharedSlot: number
}
