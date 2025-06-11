import { DomiaType } from "@/modules/core"

import { audioCaptureLogger, domiaError, AUDIO_ERRORS } from "@/utils"
import { type CaptureCallbacksType } from "../../types"

export const runPorcupine = async (
	domia: DomiaType,
	callbacks?: CaptureCallbacksType,
) => {
	const wakeWordConfig = domia.wakeWordConfig

	if (!wakeWordConfig) {
		const err = domiaError(AUDIO_ERRORS.WAKE_WORD_CONFIG_NOT_FOUND, {
			logger: audioCaptureLogger,
		})
		callbacks?.onError?.(err)
		throw err
	}
}
