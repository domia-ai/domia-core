import { z } from "zod"

import type { BuiltinToolType } from "../../../../types"
import {
	DOMIA_CLOCK_RE,
	DOMIA_REMINDER_ACTION_ENUM,
	DOMIA_REMINDER_ACTION_ENUM_VALUES,
	DOMIA_REMINDER_MAX_SECONDS,
	DOMIA_REMINDER_TEXT_MAX_CHARS,
	DOMIA_TOOL_REMINDER,
	DOMIA_WRITE_HINTS,
} from "../../constants"
import { errorResult, builtinToolPacks, okResult, phrase } from "../../packs"
import { nextClockOccurrence, secondsUntil } from "../alarm/registry"
import {
	announceTargetExists,
	cancelTimers,
	destinationDiffers,
	destinationName,
	startTimer,
} from "../timer/registry"
import en from "./descriptors/en.json"
import es from "./descriptors/es.json"

const dueOf = (args: Record<string, unknown>, now: Date): Date | null =>
	typeof args.seconds === "number"
		? new Date(now.getTime() + args.seconds * 1000)
		: typeof args.at === "string"
			? nextClockOccurrence(args.at, now)
			: null

export const reminderTool: BuiltinToolType = {
	name: DOMIA_TOOL_REMINDER,
	definition: {
		name: DOMIA_TOOL_REMINDER,
		description:
			"Sets a spoken reminder with free text, either after a delay (seconds) or at a clock time (at, 24h HH:MM, next occurrence). action=cancel cancels pending reminders.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: [...DOMIA_REMINDER_ACTION_ENUM_VALUES],
					description: "set (default) or cancel",
				},
				text: {
					type: "string",
					description: "What to remind, as the user said it",
				},
				seconds: {
					type: "integer",
					minimum: 1,
					maximum: DOMIA_REMINDER_MAX_SECONDS,
					description: "Delay in seconds from now",
				},
				at: { type: "string", description: "Clock time HH:MM (24h)" },
			},
		},
		annotations: DOMIA_WRITE_HINTS,
	},
	schema: z
		.object({
			action: z.enum(DOMIA_REMINDER_ACTION_ENUM_VALUES).optional(),
			text: z
				.string()
				.trim()
				.min(1)
				.max(DOMIA_REMINDER_TEXT_MAX_CHARS)
				.optional(),
			seconds: z
				.number()
				.int()
				.min(1)
				.max(DOMIA_REMINDER_MAX_SECONDS)
				.optional(),
			at: z.string().regex(DOMIA_CLOCK_RE).optional(),
		})
		.strict(),
	packs: builtinToolPacks({ en, es }),
	available: announceTargetExists,
	execute: async (args, ctx) => {
		if (args.action === DOMIA_REMINDER_ACTION_ENUM.CANCEL) {
			const cancelled = await cancelTimers(ctx, "reminder")
			if (cancelled.length === 0)
				return okResult(
					"No reminder is pending.",
					phrase(ctx.sets, "noActiveReminder"),
				)
			return okResult(
				`Cancelled ${cancelled.length} reminder(s).`,
				phrase(ctx.sets, "reminderCancelled"),
				{ cancelled: cancelled.map((t) => t.id) },
			)
		}
		const text = typeof args.text === "string" ? args.text : null
		const now = new Date()
		const due = dueOf(args, now)
		if (!text || !due)
			return errorResult(
				"A reminder needs text and either seconds or at (HH:MM).",
				phrase(ctx.sets, "reminderNeedsTime"),
			)
		try {
			const result = await startTimer(ctx, "reminder", {
				seconds: secondsUntil(due, now),
				label: text,
				text,
				dueAt: due.toISOString(),
			})
			const base = phrase(ctx.sets, "reminderSet", { text })
			const speakable = destinationDiffers(ctx.origin, result)
				? `${base} ${phrase(ctx.sets, "announcedOn", { target: destinationName(ctx, result) })}`
				: base
			return okResult(
				`Reminder "${text}" set for ${result.timer.dueAt}.`,
				speakable,
				{ id: result.timer.id, text, dueAt: result.timer.dueAt },
			)
		} catch (error) {
			return errorResult(
				`Reminder could not be set: ${error instanceof Error ? error.message : String(error)}`,
				phrase(ctx.sets, "timerFailed"),
			)
		}
	},
}
