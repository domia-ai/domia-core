import { type DomiaType } from "@/modules/core"
import { transcribeStt } from "@/modules/ml-client"
import { STT_ERRORS, sttEngineLogger, domiaError } from "@/utils"
import { STT_ENGINE_ENUM } from "@/db"

export const runWhisper = async (domia: DomiaType, filePath: string) => {
	const sttConfig = domia?.sttConfig

	if (!sttConfig) {
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
		})
	}

	const result = await transcribeStt({
		engine: STT_ENGINE_ENUM.WHISPER,
		filePath,
		modelName: sttConfig.modelName,
	})
	return result.transcript
}
