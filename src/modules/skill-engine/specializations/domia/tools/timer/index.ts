import { z } from "zod"

import type { BuiltinToolType } from "../../../../types"
import {
	DOMIA_TIMER_LABEL_MAX_CHARS,
	DOMIA_TIMER_MAX_SECONDS,
	DOMIA_TOOL_TIMER,
	DOMIA_WRITE_HINTS,
} from "../../constants"
import {
	durationLabel,
	errorResult,
	builtinToolPacks,
	okResult,
	phrase,
} from "../../packs"
import {
	announceTargetExists,
	destinationDiffers,
	destinationName,
	startTimer,
} from "./registry"
import en from "./descriptors/en.json"
import es from "./descriptors/es.json"

export const timerTool: BuiltinToolType = {
	name: DOMIA_TOOL_TIMER,
	definition: {
		name: DOMIA_TOOL_TIMER,
		description:
			"Starts a countdown timer that announces when it ends. seconds = total duration in seconds; label = optional short name (e.g. pasta).",
		inputSchema: {
			type: "object",
			properties: {
				seconds: {
					type: "integer",
					minimum: 1,
					maximum: DOMIA_TIMER_MAX_SECONDS,
					description: "Duration in seconds",
				},
				label: { type: "string", description: "Optional short name" },
			},
			required: ["seconds"],
		},
		annotations: DOMIA_WRITE_HINTS,
	},
	schema: z
		.object({
			seconds: z.number().int().min(1).max(DOMIA_TIMER_MAX_SECONDS),
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
		const seconds = args.seconds as number
		const label =
			typeof args.label === "string"
				? args.label
				: durationLabel(seconds, ctx.sets)
		try {
			const result = await startTimer(ctx, "timer", { seconds, label })
			const speakable = destinationDiffers(ctx.origin, result)
				? phrase(ctx.sets, "timerSetOn", {
						label,
						target: destinationName(ctx, result),
					})
				: phrase(ctx.sets, "timerSet", { label })
			return okResult(
				`Timer "${label}" set for ${seconds} seconds (due ${result.timer.dueAt}).`,
				speakable,
				{
					id: result.timer.id,
					label,
					seconds,
					dueAt: result.timer.dueAt,
					destination: result.destination,
				},
			)
		} catch (error) {
			return errorResult(
				`Timer could not be started: ${error instanceof Error ? error.message : String(error)}`,
				phrase(ctx.sets, "timerFailed"),
			)
		}
	},
}
