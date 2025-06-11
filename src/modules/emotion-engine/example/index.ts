import { getDomia } from "@/modules/core"
import { triggerEmotion, decayEmotion, getEmotionContext } from ".."
;(async () => {
	const domia = await getDomia()
	if (!domia) {
		throw new Error(`Domia not found`)
	}

	await triggerEmotion(domia, "User pet the dog", {
		joy: 0.4,
		trust: 0.2,
	})
	getEmotionContext(domia)
	await decayEmotion(domia)
})()
