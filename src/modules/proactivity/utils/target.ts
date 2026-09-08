import type { PresenceEntryType, SpeakTargetType } from "@/modules/core-bus"
import type { ProactiveTargetKindType, ProactiveActivityType } from "../types"

export const resolveProactiveTarget = (
	presence: PresenceEntryType | undefined,
	targetKind: ProactiveTargetKindType,
	targetSatelliteId: string | null,
	lastActivity: ProactiveActivityType | null,
): SpeakTargetType | undefined => {
	if (targetKind === "local") return { kind: "local" }
	if (targetKind === "satellite" && targetSatelliteId)
		return { kind: "satellite", satelliteId: targetSatelliteId }
	const connected = (presence?.satellites ?? []).filter((s) => s.connected)
	if (connected.length === 0) return undefined
	const recent = lastActivity?.satelliteId
	if (recent && connected.some((s) => s.satelliteId === recent))
		return { kind: "satellite", satelliteId: recent }
	const byTurn = [...connected].sort(
		(a, b) => (b.lastTurnAt ?? 0) - (a.lastTurnAt ?? 0),
	)
	const best = byTurn[0]
	if (best.lastTurnAt === null) return undefined
	return { kind: "satellite", satelliteId: best.satelliteId }
}
