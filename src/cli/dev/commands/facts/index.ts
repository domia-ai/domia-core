import { writeFileSync } from "fs"

import { env } from "@/config"
import { getDomia } from "@/modules/core"
import { auditStoredFacts, deleteStoredFacts } from "@/modules/memory"
import { devCliLogger } from "@/utils"

const loadDomia = async () => {
	const domia = await getDomia(env.DOMIA_KEY)
	if (!domia) throw new Error(`No domia found for key ${env.DOMIA_KEY}`)
	return domia
}

export const factsAuditCommand = async () => {
	try {
		const domia = await loadDomia()
		const garbage = await auditStoredFacts(domia)
		devCliLogger.info(
			`🧠 fact audit for ${domia.domiaKey}: ${garbage.length} invalid`,
		)
		for (const g of garbage)
			devCliLogger.info(
				`  ✗ [${g.reason}] ${g.row.subject} ${g.row.relation} ${g.row.value}`,
			)
	} catch (error) {
		devCliLogger.error("❌ fact audit failed", error)
	}
}

export const factsCleanupCommand = async (opts: { apply?: boolean }) => {
	try {
		const domia = await loadDomia()
		const garbage = await auditStoredFacts(domia)
		if (garbage.length === 0) {
			devCliLogger.info("🧠 fact cleanup: nothing to remove")
			return
		}
		const backupPath = `data/db/fact-cleanup-backup-${Date.now()}.json`
		writeFileSync(
			backupPath,
			JSON.stringify(
				garbage.map((g) => ({ reason: g.reason, ...g.row })),
				null,
				"\t",
			),
		)
		devCliLogger.info(
			`🧠 fact cleanup: ${garbage.length} invalid facts (backup → ${backupPath})`,
		)
		if (!opts.apply) {
			devCliLogger.info("dry run — pass --apply to delete")
			return
		}
		const removed = await deleteStoredFacts(garbage.map((g) => g.row.id))
		devCliLogger.info(`🧹 removed ${removed} facts`)
	} catch (error) {
		devCliLogger.error("❌ fact cleanup failed", error)
	}
}
