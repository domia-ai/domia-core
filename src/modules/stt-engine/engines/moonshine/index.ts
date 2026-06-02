import { STT_ENGINE_ENUM } from "@/db"
import { runSttPooled } from "../../utils"
import type { SttEngineAdapterType } from "../../types"

export const moonshineEngine: SttEngineAdapterType = {
	id: STT_ENGINE_ENUM.MOONSHINE,
	capabilities: {
		streaming: false,
		expectedSampleRate: 16000,
	},
	run: runSttPooled,
}
