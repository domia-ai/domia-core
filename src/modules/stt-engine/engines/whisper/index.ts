import { STT_ENGINE_ENUM } from "@/db"
import { runSttPooled, runSttPcmPooled } from "../../utils"
import type { SttEngineAdapterType } from "../../types"

export const whisperEngine: SttEngineAdapterType = {
	id: STT_ENGINE_ENUM.WHISPER,
	capabilities: {
		streaming: false,
		expectedSampleRate: 16000,
	},
	run: runSttPooled,
	runPcm: runSttPcmPooled,
}
