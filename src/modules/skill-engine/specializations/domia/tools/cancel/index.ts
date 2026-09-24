import { z } from "zod"

import type { BuiltinToolType } from "../../../../types"
import { DOMIA_READ_HINTS, DOMIA_TOOL_CANCEL } from "../../constants"
import { builtinToolPacks, okResult, phrase } from "../../packs"
import en from "./descriptors/en.json"
import es from "./descriptors/es.json"

export const cancelTool: BuiltinToolType = {
	name: DOMIA_TOOL_CANCEL,
	definition: {
		name: DOMIA_TOOL_CANCEL,
		description:
			"The user dismisses the request (never mind, forget it). Does nothing and acknowledges briefly.",
		inputSchema: { type: "object", properties: {} },
		annotations: DOMIA_READ_HINTS,
	},
	schema: z.object({}).strict(),
	packs: builtinToolPacks({ en, es }),
	hiddenFromLlm: true,
	execute: (_args, ctx) =>
		Promise.resolve(
			okResult(
				"Request dismissed by the user.",
				phrase(ctx.sets, "okayNeverMind"),
			),
		),
}
