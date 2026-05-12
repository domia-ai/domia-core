import { type SttEngineEnumType, STT_ENGINE_ENUM } from "@/db"

import { whisperEngine } from "./whisper"
import { moonshineEngine } from "./moonshine"
import type { SttEngineAdapterType } from "../types"

export const sttEngineRegistry: Record<
	SttEngineEnumType,
	SttEngineAdapterType
> = {
	[STT_ENGINE_ENUM.WHISPER]: whisperEngine,
	[STT_ENGINE_ENUM.MOONSHINE]: moonshineEngine,
}

export const getSttEngine = (
	id: SttEngineEnumType,
): SttEngineAdapterType | null => sttEngineRegistry[id] ?? null

export const sttEngines = {
	[STT_ENGINE_ENUM.WHISPER]: whisperEngine.run,
	[STT_ENGINE_ENUM.MOONSHINE]: moonshineEngine.run,
}
