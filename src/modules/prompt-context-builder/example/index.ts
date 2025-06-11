import { getDomia } from "@/modules/core"
import { buildPromptContext } from "../"
;(async () => {
	const domia = await getDomia()
	if (!domia) {
		throw new Error(`Domia not found`)
	}

	buildPromptContext(domia, "")
})()
