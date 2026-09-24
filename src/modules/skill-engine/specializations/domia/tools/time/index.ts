import { capitalizeFirst } from "@/utils/text-tokens"
import { z } from "zod"

import type { BuiltinToolType } from "../../../../types"
import { DOMIA_READ_HINTS, DOMIA_TOOL_TIME } from "../../constants"
import { builtinToolPacks, okResult, phrase } from "../../packs"
import en from "./descriptors/en.json"
import es from "./descriptors/es.json"

export const timeTool: BuiltinToolType = {
	name: DOMIA_TOOL_TIME,
	definition: {
		name: DOMIA_TOOL_TIME,
		description:
			"Tells the current local time. Use when the user asks what time it is now.",
		inputSchema: { type: "object", properties: {} },
		annotations: DOMIA_READ_HINTS,
	},
	schema: z.object({}).strict(),
	packs: builtinToolPacks({ en, es }),
	execute: (_args, ctx) => {
		const now = new Date()
		const spoken = ctx.sets.spokenTime(now)
		return Promise.resolve(
			okResult(
				`Current local time: ${now.toISOString()} (${spoken}).`,
				capitalizeFirst(phrase(ctx.sets, "currentTime", { time: spoken })),
				{ iso: now.toISOString(), spoken },
			),
		)
	},
}
