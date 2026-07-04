import { appLogger } from "@/utils"
import { reloadTtsPool } from "@/modules/tts-engine"
import { reloadSttPool } from "@/modules/stt-engine"
import { closeDb } from "@/db"
import type { ShutdownTaskType } from "./types"

const tasks: ShutdownTaskType[] = []
const HARD_DEADLINE_MS = 8000
let started = false

export const registerShutdownTask = (
	name: string,
	run: () => Promise<void> | void,
): void => {
	tasks.push({ name, run })
}

const runShutdown = async (signal: string): Promise<void> => {
	if (started) return
	started = true
	appLogger.info(`🛑 shutdown (${signal}) — draining ${tasks.length} task(s)`)
	const drain = Promise.allSettled(
		tasks.map(async (t) => {
			try {
				await t.run()
			} catch (err) {
				appLogger.warn(`shutdown task "${t.name}" failed`, { err })
			}
		}),
	)
	const deadline = new Promise<void>((resolve) => {
		const timer = setTimeout(() => {
			appLogger.warn("shutdown hard deadline reached — forcing exit")
			resolve()
		}, HARD_DEADLINE_MS)
		timer.unref()
	})
	await Promise.race([drain, deadline])
	appLogger.info("🛑 shutdown complete — exiting")
	process.exit(0)
}

export const setupShutdown = (): void => {
	registerShutdownTask("tts-pool", reloadTtsPool)
	registerShutdownTask("stt-pool", reloadSttPool)
	registerShutdownTask("db", closeDb)
	process.once("SIGTERM", () => void runShutdown("SIGTERM"))
	process.once("SIGINT", () => void runShutdown("SIGINT"))
}
