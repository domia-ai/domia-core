import { DomiaType } from "@/modules/core"
import { type SttEngineEnumType, STT_ENGINE_ENUM } from "@/db"

import { runVosk } from "./vosk"
import { runWhisper } from "./whisper"

export const sttEngines: Record<
	SttEngineEnumType,
	(domia: DomiaType, filePath: string) => Promise<string>
> = {
	[STT_ENGINE_ENUM.VOSK]: runVosk,
	[STT_ENGINE_ENUM.WHISPER]: runWhisper,
}
