import { STT_ENGINE_ENUM } from "@/db"
import {
	runSttPooled,
	collectStreamAndTranscribePooled,
	runSttPcmPooled,
	createSttSessionPooled,
} from "../../utils"
import type { SttEngineAdapterType } from "../../types"

const SAMPLE_RATE = 16000

export const zipformerEngine: SttEngineAdapterType = {
	id: STT_ENGINE_ENUM.ZIPFORMER,
	capabilities: {
		streaming: true,
		expectedSampleRate: SAMPLE_RATE,
	},
	run: runSttPooled,
	runStream: collectStreamAndTranscribePooled,
	runPcm: runSttPcmPooled,
	createSession: createSttSessionPooled,
}
