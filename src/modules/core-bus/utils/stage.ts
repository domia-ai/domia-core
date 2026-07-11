import { emitTurnEvent, DOMIA_TURN_EVENT_ENUM } from "@/buses"
import type { TurnStageNameType } from "@/buses"
import type { StageEnvelopeType } from "../types"

export const stage = async <T>(
	env: StageEnvelopeType,
	stageName: TurnStageNameType,
	fn: () => Promise<T>,
): Promise<T> => {
	const startedAt = Date.now()
	emitTurnEvent({
		type: DOMIA_TURN_EVENT_ENUM.STAGE_STARTED,
		interactionId: env.interactionId,
		originDomiaKey: env.originDomiaKey,
		satelliteId: env.satelliteId,
		traceId: env.traceId,
		stageName,
	})
	const done = (status: "ok" | "failed", errorMessage?: string): void => {
		emitTurnEvent({
			type: DOMIA_TURN_EVENT_ENUM.STAGE_DONE,
			interactionId: env.interactionId,
			originDomiaKey: env.originDomiaKey,
			satelliteId: env.satelliteId,
			traceId: env.traceId,
			stageName,
			elapsedMs: Date.now() - startedAt,
			status,
			errorMessage,
		})
	}
	try {
		const result = await fn()
		done("ok")
		return result
	} catch (err) {
		done("failed", err instanceof Error ? err.message : String(err))
		throw err
	}
}
