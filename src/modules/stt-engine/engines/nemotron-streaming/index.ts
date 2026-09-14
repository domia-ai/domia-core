import { STT_ENGINE_ENUM } from "@/db"
import {
	runSttPooled,
	collectStreamAndTranscribePooled,
	runSttPcmPooled,
	createSttSessionPooled,
} from "../../utils"
import type { SttEngineAdapterType } from "../../types"

const SAMPLE_RATE = 16000

export const nemotronStreamingEngine: SttEngineAdapterType = {
	id: STT_ENGINE_ENUM.NEMOTRON_STREAMING,
	capabilities: {
		streaming: true,
		expectedSampleRate: SAMPLE_RATE,
	},
	run: runSttPooled,
	runStream: collectStreamAndTranscribePooled,
	runPcm: runSttPcmPooled,
	createSession: createSttSessionPooled,
}
