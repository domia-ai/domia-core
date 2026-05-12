import { type TtsEngineEnumType, TTS_ENGINE_ENUM } from "@/db"

import { kokoroEngine } from "./kokoro"
import type { TtsEngineAdapterType } from "../types"

export const ttsEngineRegistry: Record<
	TtsEngineEnumType,
	TtsEngineAdapterType
> = {
	[TTS_ENGINE_ENUM.KOKORO]: kokoroEngine,
}

export const getTtsEngine = (
	id: TtsEngineEnumType,
): TtsEngineAdapterType | null => ttsEngineRegistry[id] ?? null

export const ttsEngines = {
	[TTS_ENGINE_ENUM.KOKORO]: kokoroEngine.run,
}
