import { getDomia } from "@/modules/core"
import { updateCharacterProfileByDomiaId, getCharacterContext } from "../"
;(async () => {
	const domia = await getDomia()

	if (!domia) {
		throw new Error(`Domia not found`)
	}

	const characterProfile = domia?.characterProfile

	if (!characterProfile) {
		throw new Error(`Character profile not found`)
	}

	getCharacterContext(domia)
	await updateCharacterProfileByDomiaId(domia?.id, {
		...characterProfile,
		profession: "CHEF",
		communicationStyle: "SARCASTIC",
	})
})()
