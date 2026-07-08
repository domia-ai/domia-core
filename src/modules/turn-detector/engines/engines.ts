import {
	TURN_DETECTOR_ENGINE_ENUM,
	type TurnDetectorEngineEnumType,
} from "@/db"
import { smartTurnDetector } from "./smart-turn"
import type { TurnDetectorEngineAdapterType } from "../types"

export const turnDetectorEngineRegistry: Record<
	TurnDetectorEngineEnumType,
	TurnDetectorEngineAdapterType
> = {
	[TURN_DETECTOR_ENGINE_ENUM.SMART_TURN]: smartTurnDetector,
}

export const getTurnDetectorEngine = (
	id: TurnDetectorEngineEnumType,
): TurnDetectorEngineAdapterType | null =>
	turnDetectorEngineRegistry[id] ?? null
