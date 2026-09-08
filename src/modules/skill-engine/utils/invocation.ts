import { skillEngineLogger } from "@/utils"

import type {
	SkillConnectionType,
	ToolInvocationDescriptionType,
} from "../types"

export const genericInvocationTarget = (
	args: Record<string, unknown>,
): string | null => {
	for (const value of Object.values(args))
		if (typeof value === "string" && value.trim()) return value.trim()
	return null
}

export const describeConnectionInvocation = (
	conn: SkillConnectionType | null | undefined,
	rawName: string,
	args: Record<string, unknown>,
	language?: string | null,
): ToolInvocationDescriptionType => {
	const hook = conn?.specialization?.describeInvocation
	if (conn && hook) {
		try {
			const described = hook(
				conn.provider,
				rawName,
				args,
				language ?? conn.language,
			)
			if (described) return described
		} catch (err) {
			skillEngineLogger.warn("specialization describeInvocation failed", {
				provider: conn.name,
				tool: rawName,
				err,
			})
		}
	}
	const target = genericInvocationTarget(args)
	return target ? { target } : {}
}
