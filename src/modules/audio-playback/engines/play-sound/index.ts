import { DomiaType } from "@/modules/core"
import { audioPlaybackLogger } from "@/utils"
import { AudioPlaybackResult } from "../../types"

export const runPlaySound = async (
	domia: DomiaType,
	filePath: string,
): Promise<AudioPlaybackResult> => {
	const config = domia.audioPlaybackConfig
	const volume = config?.volume ?? 100

	audioPlaybackLogger.info("🔊 Running Sox playback", {
		domiaId: domia?.id,
		filePath,
		engine: "sox",
		volume,
	})

	return {
		engine: "PLAY-SOUND",
		success: false,
	}
}
