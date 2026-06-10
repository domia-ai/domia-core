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

const META_KEYS = new Set([
	"id",
	"domiaId",
	"createdAt",
	"updatedAt",
	"type",
	"isActive",
])

const stripMeta = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(stripMeta)
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(value))
			if (!META_KEYS.has(k)) out[k] = stripMeta(v)
		return out
	}
	return value
}

export const configShowCommand = async () => {
	try {
		const domia = await loadDomia()
		devCliLogger.info(`⚙️  Current config of ${domia.name}`)
		devCliLogger.debug(JSON.stringify(serializeConfig(domia), null, 2))
	} catch (error) {
		devCliLogger.error("❌ Error reading config", error)
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
	}
}

export const configExportCommand = async (out: string) => {
	try {
		const domia = await loadDomia()
		writeFileSync(out, JSON.stringify(serializeConfig(domia), null, 2))
		devCliLogger.info(`📤 Exported config → ${out}`)
	} catch (error) {
		devCliLogger.error("❌ Error exporting config", error)
	}
}

export const configImportCommand = async (file: string) => {
	try {
		const domia = await loadDomia()
		const parsed = JSON.parse(readFileSync(file, "utf-8"))
		const bundle = stripMeta(parsed.config ?? parsed)
		await persistConfig(domia, bundle)
		await requestServiceRestart()
		devCliLogger.info(`📥 Imported config from ${file} — restarting`)
	} catch (error) {
		devCliLogger.error("❌ Error importing config", error)
	}
}
