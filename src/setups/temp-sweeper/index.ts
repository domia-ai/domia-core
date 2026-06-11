import { readdir, stat, unlink } from "fs/promises"
import os from "os"
import path from "path"

import { DEFAULT_TMP_AUDIO_TTL_MS, DEFAULT_TMP_SWEEP_INTERVAL_MS } from "@/db"
import { appLogger } from "@/utils"

const SWEEP_DIRS = [
	path.resolve("tmp/recordings"),
	path.resolve("tmp/tts-output"),
	os.tmpdir(),
]

const TMP_WAV_PATTERN = /^(domia-|voice-|stt-upload-|domia-tts-stream-).*\.wav$/

const sweepDir = async (dir: string, maxAgeMs: number): Promise<number> => {
	let removed = 0
	let entries: string[]
	try {
		entries = await readdir(dir)
	} catch {
		return 0
	}
	const cutoff = Date.now() - maxAgeMs
	for (const entry of entries) {
		if (!TMP_WAV_PATTERN.test(entry)) continue
		const filePath = path.join(dir, entry)
		try {
			const info = await stat(filePath)
			if (info.isFile() && info.mtimeMs < cutoff) {
				await unlink(filePath)
				removed++
			}
		} catch {
			continue
		}
	}
	return removed
}

export const setupTempSweeper = (): void => {
	const sweep = async (): Promise<void> => {
		let total = 0
		for (const dir of SWEEP_DIRS) {
			total += await sweepDir(dir, DEFAULT_TMP_AUDIO_TTL_MS)
		}
		if (total > 0) {
			appLogger.info(`🧹 temp sweeper removed ${total} stale audio file(s)`)
		}
	}
	void sweep()
	const timer = setInterval(() => void sweep(), DEFAULT_TMP_SWEEP_INTERVAL_MS)
	timer.unref()
}
