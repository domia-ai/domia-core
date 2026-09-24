import { z } from "zod"

import type { BuiltinToolType } from "../../../../types"
import { DOMIA_TOOL_ALARM_CANCEL, DOMIA_WRITE_HINTS } from "../../constants"
import { builtinToolPacks, okResult, phrase } from "../../packs"
import { cancelTimers } from "../timer/registry"
import en from "./descriptors/en.json"
import es from "./descriptors/es.json"

export const alarmCancelTool: BuiltinToolType = {
	name: DOMIA_TOOL_ALARM_CANCEL,
	definition: {
		name: DOMIA_TOOL_ALARM_CANCEL,
		description: "Cancels the pending alarm(s) set from this device.",
		inputSchema: { type: "object", properties: {} },
		annotations: { ...DOMIA_WRITE_HINTS, idempotentHint: true },
	},
	schema: z.object({}).strict(),
	packs: builtinToolPacks({ en, es }),
	hiddenFromLlm: true,
	execute: async (_args, ctx) => {
		const cancelled = await cancelTimers(ctx, "alarm")
		if (cancelled.length === 0)
			return okResult("No alarm is set.", phrase(ctx.sets, "noActiveAlarm"))
		return okResult(
			`Cancelled ${cancelled.length} alarm(s): ${cancelled.map((t) => t.label).join(", ")}.`,
			phrase(ctx.sets, "alarmCancelled"),
			{ cancelled: cancelled.map((t) => t.id) },
		)
	},
}
