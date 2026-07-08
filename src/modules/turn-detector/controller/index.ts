import {
	DEFAULT_TURN_DETECTOR_ENGINE,
	type TurnDetectorEngineEnumType,
} from "@/db"
import { getTurnDetectorEngine } from "../engines"
import type { TurnDetectorResultType } from "../types"

const engine = (id?: TurnDetectorEngineEnumType) =>
	getTurnDetectorEngine(id ?? DEFAULT_TURN_DETECTOR_ENGINE)

export const turnDetectorAvailable = (
	modelPath: string,
	engineId?: TurnDetectorEngineEnumType,
): boolean => engine(engineId)?.available(modelPath) ?? false

export const predictTurnComplete = (
	audio16k: Float32Array,
	modelPath: string,
	threshold?: number,
	engineId?: TurnDetectorEngineEnumType,
): Promise<TurnDetectorResultType | null> =>
	engine(engineId)?.predict(audio16k, modelPath, threshold) ??
	Promise.resolve(null)

export const warmTurnDetector = (
	modelPath: string,
	engineId?: TurnDetectorEngineEnumType,
): void => engine(engineId)?.warm(modelPath)
