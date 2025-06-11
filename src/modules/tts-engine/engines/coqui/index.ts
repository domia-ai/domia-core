import { DomiaType } from "@/modules/core"
import { TTS_ERRORS, ttsEngineLogger, domiaError } from "@/utils"
import { type RunTtsResultType } from "../../types"

export const runCoqui = async (
	domia: DomiaType,
	text: string,
): Promise<RunTtsResultType> => {
	const ttsConfig = domia.ttsConfig
	const voiceName = ttsConfig?.voiceName

	if (!voiceName) {
		throw domiaError(TTS_ERRORS.VOICE_NOT_FOUND, {
			logger: ttsEngineLogger,
			meta: {
				domiaId: domia.id,
				voiceName,
			},
		})
	}

	return {
		engineUsed: "PIPER",
		voiceUsed: voiceName,
		format: "wav",
		filePath: "TODO",
		metadata: {
			text,
		},
	}
}
