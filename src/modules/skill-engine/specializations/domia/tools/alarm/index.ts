import { capitalizeFirst } from "@/utils/text-tokens"
import { z } from "zod"

import type { BuiltinToolType } from "../../../../types"
import {
	DOMIA_CLOCK_RE,
	DOMIA_TIMER_LABEL_MAX_CHARS,
	DOMIA_TOOL_ALARM,
	DOMIA_WRITE_HINTS,
} from "../../constants"
import { errorResult, builtinToolPacks, okResult, phrase } from "../../packs"
import {
	announceTargetExists,
	destinationDiffers,
	destinationName,
} from "../timer/registry"
import { nextClockOccurrence, startAlarm } from "./registry"
import en from "./descriptors/en.json"
import es from "./descriptors/es.json"

export const alarmTool: BuiltinToolType = {
	name: DOMIA_TOOL_ALARM,
	definition: {
		name: DOMIA_TOOL_ALARM,
		description:
			"Sets an alarm that rings at a clock time. at = 24h HH:MM (next occurrence today or tomorrow); daily = true repeats it every day; label = optional short name.",
		inputSchema: {
			type: "object",
			properties: {
				at: { type: "string", description: "Clock time HH:MM (24h)" },
				daily: {
					type: "boolean",
					description: "Repeat every day at that time",
				},
				label: { type: "string", description: "Optional short name" },
			},
			required: ["at"],
		},
		annotations: DOMIA_WRITE_HINTS,
	},
	schema: z
		.object({
			at: z.string().regex(DOMIA_CLOCK_RE),
			daily: z.boolean().optional(),
			label: z
				.string()
				.trim()
				.min(1)
				.max(DOMIA_TIMER_LABEL_MAX_CHARS)
				.optional(),
		})
		.strict(),
	packs: builtinToolPacks({ en, es }),
	available: announceTargetExists,
	execute: async (args, ctx) => {
		const at = args.at as string
		const daily = args.daily === true
		const now = new Date()
		const due = nextClockOccurrence(at, now)
		const spokenTime = ctx.sets.spokenTime(due)
		const label = typeof args.label === "string" ? args.label : spokenTime
		try {
			const result = await startAlarm(
				ctx,
				now,
				due,
				at,
				daily,
				label,
				spokenTime,
			)
			const base = capitalizeFirst(
				phrase(ctx.sets, daily ? "alarmSetDaily" : "alarmSet", {
					time: spokenTime,
				}),
			)
			const speakable = destinationDiffers(ctx.origin, result)
				? `${base} ${phrase(ctx.sets, "announcedOn", { target: destinationName(ctx, result) })}`
				: base
			return okResult(
				`Alarm "${label}" set for ${due.toISOString()}${daily ? " (every day)" : ""}.`,
				speakable,
				{
					id: result.timer.id,
					at,
					daily,
					dueAt: result.timer.dueAt,
					destination: result.destination,
				},
			)
		} catch (error) {
			return errorResult(
				`Alarm could not be set: ${error instanceof Error ? error.message : String(error)}`,
				phrase(ctx.sets, "alarmFailed"),
			)
		}
	},
}
