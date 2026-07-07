import { type TtsEngineEnumType, TTS_ENGINE_ENUM } from "@/db"

import { kokoroEngine } from "./kokoro"
import { pocketEngine } from "./pocket"
import { vitsEngine } from "./vits"
import type { TtsEngineAdapterType } from "../types"

export const ttsEngineRegistry: Record<
	TtsEngineEnumType,
	TtsEngineAdapterType
> = {
	[TTS_ENGINE_ENUM.KOKORO]: kokoroEngine,
	[TTS_ENGINE_ENUM.POCKET]: pocketEngine,
	[TTS_ENGINE_ENUM.VITS]: vitsEngine,
}

export const getTtsEngine = (
	id: TtsEngineEnumType,
): TtsEngineAdapterType | null => ttsEngineRegistry[id] ?? null

export const ttsEngines = {
	[TTS_ENGINE_ENUM.KOKORO]: kokoroEngine.run,
	[TTS_ENGINE_ENUM.POCKET]: pocketEngine.run,
	[TTS_ENGINE_ENUM.VITS]: vitsEngine.run,
}
