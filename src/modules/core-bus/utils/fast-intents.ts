import { languageSetsFor } from "@/utils"
import { getSatelliteControl } from "./satellite-registry"
import { parseTimerIntent, startSatelliteTimer } from "./satellite-timers"
import type {
	FastIntentType,
	FastIntentContextType,
	FastIntentResultType,
	TimerIntentType,
} from "../types"

const timerIntent: FastIntentType = {
	name: "timer",
	match: (text, ctx) =>
		parseTimerIntent(text, ctx.domia.characterProfile?.language),
	handle: (params, ctx) => {
		if (!ctx.satelliteId) return null
		const control = getSatelliteControl(ctx.originDomiaKey, ctx.satelliteId)
		if (!control?.sendTimerEvent) return null
		const { seconds, label } = params as TimerIntentType
		startSatelliteTimer(ctx.originDomiaKey, ctx.satelliteId, label, seconds)
		return languageSetsFor(
			ctx.domia.characterProfile?.language,
		).phrases.timerSet.replace("{label}", label)
	},
}

const FAST_INTENTS: FastIntentType[] = [timerIntent]

export const resolveFastIntent = (
	text: string,
	ctx: FastIntentContextType,
): FastIntentResultType | null => {
	for (const intent of FAST_INTENTS) {
		const params = intent.match(text, ctx)
		if (!params) continue
		const confirm = intent.handle(params, ctx)
		if (confirm) return { name: intent.name, confirm }
	}
	return null
}
