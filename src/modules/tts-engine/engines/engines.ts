import { DomiaType } from "@/modules/core"
import { type TtsEngineEnumType, TTS_ENGINE_ENUM } from "@/db"

import { runPiper } from "./piper"
import { runCoqui } from "./coqui"
import { type RunTtsResultType } from "../types"

export const ttsEngines: Record<
	TtsEngineEnumType,
	(domia: DomiaType, text: string) => Promise<RunTtsResultType>
> = {
	[TTS_ENGINE_ENUM.PIPER]: runPiper,
	[TTS_ENGINE_ENUM.COQUI]: runCoqui,
}
