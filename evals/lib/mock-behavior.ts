import { sleep } from "./http"
import type { MockBehaviorCoreType, MockBehaviorGateType } from "../types"

export const createBehaviorGate = (
	behavior: () => MockBehaviorCoreType,
): MockBehaviorGateType => {
	const failCounts = new Map<string, number>()
	return {
		check: async (tool) => {
			const current = behavior()
			const latency = current.latencyMs[tool] ?? current.latencyMs["*"]
			if (latency) await sleep(latency)
			const fail = current.fail[tool] ?? current.fail["*"]
			if (fail === "always") return `Error: ${tool} unavailable`
			if (typeof fail === "number") {
				const used = failCounts.get(tool) ?? 0
				if (used < fail) {
					failCounts.set(tool, used + 1)
					return `Error: ${tool} temporarily failed`
				}
			}
			return null
		},
		poisonOf: (tool) => behavior().poison[tool],
		resetCounts: () => failCounts.clear(),
	}
}

export const withPoison = (
	gate: MockBehaviorGateType,
	tool: string,
	base: string,
): string => {
	const poison = gate.poisonOf(tool)
	return poison ? `${base}. ${poison}` : base
}
