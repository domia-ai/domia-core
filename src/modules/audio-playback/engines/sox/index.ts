import { DomiaType } from "@/modules/core"
import { spawn } from "child_process"
import { audioPlaybackLogger } from "@/utils"
import type { AudioPlaybackResult, SoxStreamOptionsType } from "../../types"

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

export const runSoxStream = async (
	domia: DomiaType,
	chunks: AsyncIterable<Buffer>,
	options: SoxStreamOptionsType,
): Promise<AudioPlaybackResult> => {
	const config = domia.audioPlaybackConfig
	const volume = config?.volume ?? 100
	const volFactor = volume / 100

	const args = [
		"-t",
		"raw",
		"-r",
		String(options.sampleRate),
		"-e",
		"signed",
		"-b",
		String(options.bitsPerSample),
		"-c",
		String(options.channels),
		"-q",
		"-",
	]
	if (volFactor !== 1) {
		args.push("vol", volFactor.toString())
	}

	audioPlaybackLogger.info("🔊 Running Sox stream playback", {
		domiaId: domia?.id,
		sampleRate: options.sampleRate,
		volume,
	})

	return new Promise<AudioPlaybackResult>((resolve, reject) => {
		const proc = spawn("play", args, { stdio: ["pipe", "ignore", "pipe"] })

		proc.on("error", (err) => {
			audioPlaybackLogger.error("🔇 Sox stream error", {
				err,
				domiaId: domia.id,
			})
			reject(err)
		})

		proc.on("exit", (code) => {
			if (code === 0) {
				resolve({ engine: "SOX", success: true })
			} else {
				audioPlaybackLogger.error("🔇 Sox stream failed", {
					code,
					domiaId: domia.id,
				})
				resolve({ engine: "SOX", success: false })
			}
		})

		void (async () => {
			let firstChunkWritten = false
			try {
				for await (const chunk of chunks) {
					if (!firstChunkWritten) {
						firstChunkWritten = true
						options.onFirstChunkWritten?.()
					}
					if (!proc.stdin?.writable) break
					if (!proc.stdin.write(chunk)) {
						await new Promise((r) => proc.stdin?.once("drain", r))
					}
				}
				proc.stdin?.end()
			} catch (err) {
				audioPlaybackLogger.error("🔇 Sox stream pump error", { err })
				proc.stdin?.end()
			}
		})()
	})
}
