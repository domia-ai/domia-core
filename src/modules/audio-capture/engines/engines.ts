import { DomiaType } from "@/modules/core"
import { WAKE_WORD_ENGINE_ENUM, type WakeWordEngineEnumType } from "@/db"

import { runOpenWakeWord } from "./open-wake-word"
import { runPorcupine } from "./porcupine"
import { type CaptureCallbacksType } from "../types"

export const wakeWordEngines: Record<
	WakeWordEngineEnumType,
	(domia: DomiaType, callbacks?: CaptureCallbacksType) => Promise<void>
> = {
	[WAKE_WORD_ENGINE_ENUM.OPEN_WAKE_WORD]: runOpenWakeWord,
	[WAKE_WORD_ENGINE_ENUM.PORCUPINE]: runPorcupine,
}
