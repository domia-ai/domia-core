import { WAKE_WORD_ENGINE_ENUM, type WakeWordEngineEnumType } from "@/db"

import { runKws, KWS_SAMPLE_RATE } from "./kws"
import { type WakeWordEngineAdapterType } from "../types"

export const wakeWordEngines: Record<
	WakeWordEngineEnumType,
	WakeWordEngineAdapterType
> = {
	[WAKE_WORD_ENGINE_ENUM.KWS]: {
		id: WAKE_WORD_ENGINE_ENUM.KWS,
		capabilities: { sampleRate: KWS_SAMPLE_RATE },
		run: runKws,
	},
}
