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
	match: (text) => parseTimerIntent(text),
	handle: (params, ctx) => {
		if (!ctx.satelliteId) return null
		const control = getSatelliteControl(ctx.originDomiaKey, ctx.satelliteId)
		if (!control?.sendTimerEvent) return null
		const { seconds, label } = params as TimerIntentType
		startSatelliteTimer(ctx.originDomiaKey, ctx.satelliteId, label, seconds)
		return `Timer set for ${label.replace(" timer", "")}.`
	},
}

const FAST_INTENTS: FastIntentType[] = [timerIntent]

export const resolveFastIntent = (
	text: string,
	ctx: FastIntentContextType,
): FastIntentResultType | null => {
	for (const intent of FAST_INTENTS) {
		const params = intent.match(text)
		if (!params) continue
		const confirm = intent.handle(params, ctx)
		if (confirm) return { name: intent.name, confirm }
	}
	return null
}
