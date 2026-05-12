import { DomiaType } from "@/modules/core"
import { WAKE_WORD_ENGINE_ENUM, type WakeWordEngineEnumType } from "@/db"

import { runKws } from "./kws"
import { type CaptureCallbacksType } from "../types"

export const wakeWordEngines: Record<
	WakeWordEngineEnumType,
	(domia: DomiaType, callbacks?: CaptureCallbacksType) => Promise<void>
> = {
	[WAKE_WORD_ENGINE_ENUM.KWS]: runKws,
}
