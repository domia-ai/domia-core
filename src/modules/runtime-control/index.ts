import path from "path"
import { utimesSync } from "fs"
import { env } from "@/config"
import { appLogger } from "@/utils"
import type { BootStatusType } from "./types"

export type { BootStatusType } from "./types"

let bootStatus: BootStatusType = {
	missingBinaries: [],
	voice: "off",
	voiceMissing: [],
}

export const setBootStatus = (status: BootStatusType): void => {
	bootStatus = status
}

export const getBootStatus = (): BootStatusType => bootStatus

const DEV_ENTRY_PATH = path.resolve(__dirname, "../../index.ts")

const RESTART_DELAY_MS = 250

export const requestRestart = (): void => {
	appLogger.warn("🔁 Restart requested")
	setTimeout(() => {
		if (env.NODE_ENV === "production") {
			process.exit(0)
		} else {
			try {
				const now = new Date()
				utimesSync(DEV_ENTRY_PATH, now, now)
			} catch (err) {
				appLogger.error("Dev restart (touch) failed", { err })
			}
		}
	}, RESTART_DELAY_MS)
}

export const requestServiceRestart = async (): Promise<void> => {
	if (env.NODE_ENV !== "production") {
		try {
			const now = new Date()
			utimesSync(DEV_ENTRY_PATH, now, now)
			appLogger.warn("🔁 Restart requested (dev file touch)")
		} catch (err) {
			appLogger.error("Dev restart (touch) failed", { err })
		}
		return
	}
	try {
		await fetch(`http://127.0.0.1:${env.HTTP_SERVER_PORT}/admin/restart`, {
			method: "POST",
		})
	} catch {
		appLogger.warn(
			"Domia service not reachable on loopback — config applies on next boot",
		)
	}
}
