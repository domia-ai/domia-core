import { DomiaType } from "@/modules/core"
import { spawn } from "child_process"
import { audioPlaybackLogger } from "@/utils"
import { AudioPlaybackResult } from "../../types"

export const runSox = async (
	domia: DomiaType,
	filePath: string,
): Promise<AudioPlaybackResult> => {
	const config = domia.audioPlaybackConfig
	const volume = config?.volume ?? 100
	const volFactor = volume / 100

	const args = [filePath]

	audioPlaybackLogger.info("🔊 Running Sox playback", {
		domiaId: domia?.id,
		filePath,
		engine: "sox",
		volume,
	})

	if (volFactor !== 1) {
		args.push("vol", volFactor.toString())
	}

	return new Promise((resolve, reject) => {
		const process = spawn("play", args, {
			stdio: "ignore",
		})

		process.on("error", (err) => {
			audioPlaybackLogger.error("🔇 Sox error", { err, domiaId: domia.id })
			reject(false)
		})

		process.on("exit", (code) => {
			if (code === 0) {
				resolve({
					engine: "SOX",
					success: true,
				})
			} else {
				audioPlaybackLogger.error("🔇 Sox failed", { code, domiaId: domia.id })
				resolve({
					engine: "SOX",
					success: false,
				})
			}
		})
	})
}
