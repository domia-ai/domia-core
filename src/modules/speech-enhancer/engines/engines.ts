import {
	SPEECH_ENHANCER_ENGINE_ENUM,
	type SpeechEnhancerEngineEnumType,
} from "@/db"
import { gtcrnEngine } from "./gtcrn"
import type { SpeechEnhancerEngineAdapterType } from "../types"

export const speechEnhancerEngineRegistry: Record<
	SpeechEnhancerEngineEnumType,
	SpeechEnhancerEngineAdapterType
> = {
	[SPEECH_ENHANCER_ENGINE_ENUM.GTCRN]: gtcrnEngine,
}

export const getSpeechEnhancerEngine = (
	id: SpeechEnhancerEngineEnumType,
): SpeechEnhancerEngineAdapterType | null =>
	(
		speechEnhancerEngineRegistry as Partial<typeof speechEnhancerEngineRegistry>
	)[id] ?? null
