import type { FastPathBlockType, SkillToolType } from "@/db"
import { domiaError, SKILL_ERRORS, skillEngineLogger } from "@/utils"

import { domiaSkillDescriptorSchema } from "../schemas"
import { findToolByBaseName } from "./tool-name"

export const loadFastPathPack = (raw: unknown): FastPathBlockType => {
	const parsed = domiaSkillDescriptorSchema.safeParse(raw)
	if (!parsed.success)
		throw domiaError(SKILL_ERRORS.INVALID_PROVIDER_CONFIG, {
			logger: skillEngineLogger,
			meta: {
				reason: "fast-path pack failed schema validation",
				issues: parsed.error.issues.map(
					(i) => `${i.path.join(".")}: ${i.message}`,
				),
			},
		})
	if (!parsed.data.fastPath)
		throw domiaError(SKILL_ERRORS.INVALID_PROVIDER_CONFIG, {
			logger: skillEngineLogger,
			meta: { reason: "fast-path pack has no fastPath block" },
		})
	return parsed.data.fastPath
}

export const bindFastPathTools = (
	block: FastPathBlockType,
	tools: SkillToolType[],
): FastPathBlockType | undefined => {
	const intents = block.intents.flatMap((intent) => {
		const tool = findToolByBaseName(tools, intent.tool)
		return tool ? [{ ...intent, tool: tool.rawName }] : []
	})
	if (intents.length === 0) return undefined
	return { ...block, intents }
}
