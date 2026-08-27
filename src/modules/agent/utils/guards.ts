import { hashCanonical } from "@/utils"
import type { ToolGuardConfigType, ToolGuardVerdictType } from "../types"

export const callSignature = (
	name: string,
	args: Record<string, unknown>,
): string => `${name}:${hashCanonical(args)}`

export const createToolGuards = (cfg: ToolGuardConfigType) => {
	const failures = new Map<string, { count: number; lastError: string }>()
	const okResults = new Map<string, string>()
	let reserved = 0
	let capTripped = false

	const onCallAttempt = (
		name: string,
		args: Record<string, unknown>,
	): ToolGuardVerdictType => {
		const sig = callSignature(name, args)
		if (reserved >= cfg.maxCallsPerTurn) {
			capTripped = true
			return {
				action: "block",
				syntheticResult: `Tool call limit reached for this turn. Do not call more tools — answer the user now with what you already have.`,
				forceNoTool: true,
			}
		}
		const fail = failures.get(sig)
		if (fail) {
			if (fail.count >= cfg.repeatBlockAt)
				return {
					action: "block",
					syntheticResult: `Error: "${name}" already failed with these arguments: ${fail.lastError}. Do not retry it — tell the user it couldn't be done.`,
					forceNoTool: true,
				}
			if (fail.count >= cfg.repeatWarnAt)
				return {
					action: "block",
					syntheticResult: `Error: "${name}" was already attempted with these arguments and failed: ${fail.lastError}. Do not retry it — tell the user it couldn't be done.`,
				}
		}
		const cached = okResults.get(sig)
		if (cached !== undefined)
			return {
				action: "block",
				syntheticResult: `You already have this information from an earlier call: ${cached}. Answer the user now.`,
			}
		reserved++
		return { action: "allow" }
	}

	const onResult = (
		name: string,
		args: Record<string, unknown>,
		ok: boolean,
		text: string,
		cacheOk: boolean,
	): void => {
		const sig = callSignature(name, args)
		if (ok) {
			if (cacheOk) okResults.set(sig, text.slice(0, 240))
			failures.delete(sig)
			return
		}
		const prev = failures.get(sig)
		failures.set(sig, {
			count: (prev?.count ?? 0) + 1,
			lastError: text.slice(0, 120),
		})
	}

	return {
		onCallAttempt,
		onResult,
		wasCapTripped: () => capTripped,
	}
}
