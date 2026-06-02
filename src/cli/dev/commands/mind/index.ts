import { readFileSync, writeFileSync } from "fs"

import { env } from "@/config"
import { getDomia } from "@/modules/core"
import {
	serializeMind,
	importMind,
	listTemplates,
	activateTemplate,
} from "@/modules/mind"
import { devCliLogger } from "@/utils"

const loadDomia = async () => {
	const domia = await getDomia(env.DOMIA_KEY)
	if (!domia) throw new Error(`No domia found for key ${env.DOMIA_KEY}`)
	return domia
}

export const mindShowCommand = async () => {
	try {
		const domia = await loadDomia()
		devCliLogger.info(`🧠 Current mind of ${domia.name}`)
		devCliLogger.debug(JSON.stringify(serializeMind(domia), null, 2))
	} catch (error) {
		devCliLogger.error("❌ Error reading mind", error)
	}
}

export const mindExportCommand = async (out: string) => {
	try {
		const domia = await loadDomia()
		writeFileSync(out, JSON.stringify(serializeMind(domia), null, 2))
		devCliLogger.info(`📤 Exported current mind → ${out}`)
	} catch (error) {
		devCliLogger.error("❌ Error exporting mind", error)
	}
}

export const mindImportCommand = async (file: string) => {
	try {
		const domia = await loadDomia()
		const parsed = JSON.parse(readFileSync(file, "utf-8"))
		importMind(domia, parsed.mind ?? parsed)
		devCliLogger.info(`📥 Imported mind from ${file}`)
		devCliLogger.info(
			"ℹ️  Restart the running service (or use the HTTP API) for a live process to pick it up.",
		)
	} catch (error) {
		devCliLogger.error("❌ Error importing mind", error)
	}
}

export const mindTemplatesCommand = async () => {
	devCliLogger.info("🌱 Built-in templates (start one with `mind use <id>`)")
	for (const t of listTemplates()) {
		devCliLogger.info(`  ${t.id}  ${t.name} — ${t.description}`)
	}
}

export const mindUseCommand = async (templateId: string) => {
	try {
		const domia = await loadDomia()
		activateTemplate(domia, templateId)
		devCliLogger.info(`🎭 Started from template "${templateId}"`)
		devCliLogger.info(
			"ℹ️  Restart the running service (or use the HTTP API) for a live process to pick it up.",
		)
	} catch (error) {
		devCliLogger.error("❌ Error activating template", error)
	}
}
