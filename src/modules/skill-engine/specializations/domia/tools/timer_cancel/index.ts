import { z } from "zod"

import type { BuiltinToolType } from "../../../../types"
import { DOMIA_TOOL_TIMER_CANCEL, DOMIA_WRITE_HINTS } from "../../constants"
import { builtinToolPacks, okResult, phrase } from "../../packs"
import { cancelTimers } from "../timer/registry"
import en from "./descriptors/en.json"
import es from "./descriptors/es.json"

export const timerCancelTool: BuiltinToolType = {
	name: DOMIA_TOOL_TIMER_CANCEL,
	definition: {
		name: DOMIA_TOOL_TIMER_CANCEL,
		description:
			"Cancels the running countdown timer(s) started from this device.",
		inputSchema: { type: "object", properties: {} },
		annotations: { ...DOMIA_WRITE_HINTS, idempotentHint: true },
	},
	schema: z.object({}).strict(),
	packs: builtinToolPacks({ en, es }),
	hiddenFromLlm: true,
	execute: async (_args, ctx) => {
		const cancelled = await cancelTimers(ctx, "timer")
		if (cancelled.length === 0)
			return okResult("No timer is running.", phrase(ctx.sets, "noActiveTimer"))
		return okResult(
			`Cancelled ${cancelled.length} timer(s): ${cancelled.map((t) => t.label).join(", ")}.`,
			phrase(ctx.sets, "timerCancelled"),
			{ cancelled: cancelled.map((t) => t.id) },
		)
	},
}
