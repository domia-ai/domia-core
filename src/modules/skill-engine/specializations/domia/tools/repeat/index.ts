import { z } from "zod"

import type { BuiltinToolType } from "../../../../types"
import { DOMIA_READ_HINTS, DOMIA_TOOL_REPEAT } from "../../constants"
import { builtinToolPacks, okResult, phrase } from "../../packs"
import en from "./descriptors/en.json"
import es from "./descriptors/es.json"

export const repeatTool: BuiltinToolType = {
	name: DOMIA_TOOL_REPEAT,
	definition: {
		name: DOMIA_TOOL_REPEAT,
		description:
			"Repeats the assistant's last spoken reply verbatim. Use when the user did not hear or asks to say it again.",
		inputSchema: { type: "object", properties: {} },
		annotations: DOMIA_READ_HINTS,
	},
	schema: z.object({}).strict(),
	packs: builtinToolPacks({ en, es }),
	hiddenFromLlm: true,
	execute: async (_args, ctx) => {
		const last = await ctx.runtime.lastReply(ctx.domia, ctx.interactionId)
		if (!last)
			return okResult(
				"There is no previous reply to repeat.",
				phrase(ctx.sets, "nothingToRepeat"),
			)
		return okResult(`Last reply: ${last}`, last, { text: last })
	},
}
