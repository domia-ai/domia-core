import { STT_ENGINE_ENUM } from "@/db"
import { runSttPooled, runSttPcmPooled } from "../../utils"
import type { SttEngineAdapterType } from "../../types"

export const parakeetEngine: SttEngineAdapterType = {
	id: STT_ENGINE_ENUM.PARAKEET,
	capabilities: {
		streaming: false,
		expectedSampleRate: 16000,
	},
	run: runSttPooled,
	runPcm: runSttPcmPooled,
}
