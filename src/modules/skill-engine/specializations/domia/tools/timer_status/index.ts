import { z } from "zod"

import type { BuiltinToolType } from "../../../../types"
import { DOMIA_READ_HINTS, DOMIA_TOOL_TIMER_STATUS } from "../../constants"
import { builtinToolPacks, okResult, phrase } from "../../packs"
import { listTimers, remainingLabel } from "../timer/registry"
import en from "./descriptors/en.json"
import es from "./descriptors/es.json"

export const timerStatusTool: BuiltinToolType = {
	name: DOMIA_TOOL_TIMER_STATUS,
	definition: {
		name: DOMIA_TOOL_TIMER_STATUS,
		description:
			"Reports how much time is left on the running countdown timer(s).",
		inputSchema: { type: "object", properties: {} },
		annotations: DOMIA_READ_HINTS,
	},
	schema: z.object({}).strict(),
	packs: builtinToolPacks({ en, es }),
	hiddenFromLlm: true,
	execute: async (_args, ctx) => {
		const timers = await listTimers(ctx, "timer")
		if (timers.length === 0)
			return okResult("No timer is running.", phrase(ctx.sets, "noActiveTimer"))
		const soonest = timers[0]
		const remaining = remainingLabel(ctx, soonest)
		return okResult(
			timers
				.map(
					(t) =>
						`"${t.label}": ${remainingLabel(ctx, t)} left (due ${t.dueAt})`,
				)
				.join("; "),
			phrase(ctx.sets, "timerRemaining", { remaining, label: soonest.label }),
			{
				timers: timers.map((t) => ({
					id: t.id,
					label: t.label,
					dueAt: t.dueAt,
					remainingSeconds: ctx.runtime.timers.remaining(t),
				})),
			},
		)
	},
}
