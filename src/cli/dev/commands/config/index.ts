import { readFileSync, writeFileSync } from "fs"

import { env } from "@/config"
import { getDomia } from "@/modules/core"
import { serializeConfig, persistConfig, configHealth } from "@/modules/config"
import { requestServiceRestart } from "@/modules/runtime-control"
import { devCliLogger } from "@/utils"

const loadDomia = async () => {
	const domia = await getDomia(env.DOMIA_KEY)
	if (!domia) throw new Error(`No domia found for key ${env.DOMIA_KEY}`)
	return domia
}

export const configShowCommand = async () => {
	try {
		const domia = await loadDomia()
		devCliLogger.info(`⚙️  Current config of ${domia.name}`)
		devCliLogger.debug(JSON.stringify(serializeConfig(domia), null, 2))
	} catch (error) {
		devCliLogger.error("❌ Error reading config", error)
		process.exitCode = 1
	}
}

export const configHealthCommand = async () => {
	try {
		const domia = await loadDomia()
		devCliLogger.info(
			`🩺 Config health (installed vs configured) of ${domia.name}`,
		)
		devCliLogger.debug(JSON.stringify(configHealth(domia), null, 2))
	} catch (error) {
		devCliLogger.error("❌ Error reading config health", error)
		process.exitCode = 1
	}
}

export const configExportCommand = async (out: string) => {
	try {
		const domia = await loadDomia()
		writeFileSync(out, JSON.stringify(serializeConfig(domia), null, 2))
		devCliLogger.info(`📤 Exported config → ${out}`)
	} catch (error) {
		devCliLogger.error("❌ Error exporting config", error)
		process.exitCode = 1
	}
}

export const configImportCommand = async (file: string) => {
	try {
		const domia = await loadDomia()
		const parsed = JSON.parse(readFileSync(file, "utf-8"))
		await persistConfig(domia, parsed.config ?? parsed)
		await requestServiceRestart()
		devCliLogger.info(`📥 Imported config from ${file} — restarting`)
	} catch (error) {
		devCliLogger.error("❌ Error importing config", error)
		process.exitCode = 1
	}
}
