import { capitalizeFirst } from "@/utils/text-tokens"
import { z } from "zod"

import type { BuiltinToolType } from "../../../../types"
import { DOMIA_READ_HINTS, DOMIA_TOOL_DATE } from "../../constants"
import { builtinToolPacks, okResult, phrase } from "../../packs"
import en from "./descriptors/en.json"
import es from "./descriptors/es.json"

export const dateTool: BuiltinToolType = {
	name: DOMIA_TOOL_DATE,
	definition: {
		name: DOMIA_TOOL_DATE,
		description:
			"Tells today's date (weekday, day, month). Use when the user asks what day or date it is.",
		inputSchema: { type: "object", properties: {} },
		annotations: DOMIA_READ_HINTS,
	},
	schema: z.object({}).strict(),
	packs: builtinToolPacks({ en, es }),
	execute: (_args, ctx) => {
		const now = new Date()
		const spoken = ctx.sets.spokenDate(now)
		return Promise.resolve(
			okResult(
				`Today's date: ${now.toISOString().slice(0, 10)} (${spoken}).`,
				capitalizeFirst(phrase(ctx.sets, "currentDate", { date: spoken })),
				{ iso: now.toISOString().slice(0, 10), spoken },
			),
		)
	},
}
