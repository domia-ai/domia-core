import { z } from "zod"

import {
	DEFAULT_AUDIO_PLAYBACK_VOLUME,
	DEFAULT_VOICE_VOLUME_STEP_PERCENT,
} from "@/db"

import type { BuiltinToolType } from "../../../../types"
import {
	DOMIA_TOOL_VOLUME,
	DOMIA_VOLUME_DIRECTION_ENUM,
	DOMIA_VOLUME_DIRECTION_ENUM_VALUES,
	DOMIA_VOLUME_MAX,
	DOMIA_VOLUME_MIN,
	DOMIA_WRITE_HINTS,
} from "../../constants"
import { errorResult, builtinToolPacks, okResult, phrase } from "../../packs"
import en from "./descriptors/en.json"
import es from "./descriptors/es.json"

const clamp = (level: number): number =>
	Math.min(DOMIA_VOLUME_MAX, Math.max(DOMIA_VOLUME_MIN, Math.round(level)))

export const volumeTool: BuiltinToolType = {
	name: DOMIA_TOOL_VOLUME,
	definition: {
		name: DOMIA_TOOL_VOLUME,
		description:
			"Adjusts the assistant's own speaking volume (its voice on this device), never music or media players. Give direction (up/down) or an absolute level 0-100.",
		inputSchema: {
			type: "object",
			properties: {
				direction: {
					type: "string",
					enum: [...DOMIA_VOLUME_DIRECTION_ENUM_VALUES],
					description: "Nudge the voice louder (up) or softer (down)",
				},
				level: {
					type: "integer",
					minimum: DOMIA_VOLUME_MIN,
					maximum: DOMIA_VOLUME_MAX,
					description: "Absolute voice volume in percent",
				},
			},
		},
		annotations: { ...DOMIA_WRITE_HINTS, idempotentHint: true },
	},
	schema: z
		.object({
			direction: z.enum(DOMIA_VOLUME_DIRECTION_ENUM_VALUES).optional(),
			level: z
				.number()
				.int()
				.min(DOMIA_VOLUME_MIN)
				.max(DOMIA_VOLUME_MAX)
				.optional(),
		})
		.strict()
		.refine((v) => v.direction !== undefined || v.level !== undefined, {
			message: "direction or level is required",
		}),
	packs: builtinToolPacks({ en, es }),
	hiddenFromLlm: true,
	available: (origin) => origin.volumeNative || origin.localPlayback,
	execute: async (args, ctx) => {
		const current = await ctx.runtime.volume.get(ctx.domia, ctx.origin)
		const base = current ?? DEFAULT_AUDIO_PLAYBACK_VOLUME
		const direction = args.direction
		const target = clamp(
			typeof args.level === "number"
				? args.level
				: direction === DOMIA_VOLUME_DIRECTION_ENUM.UP
					? base + DEFAULT_VOICE_VOLUME_STEP_PERCENT
					: base - DEFAULT_VOICE_VOLUME_STEP_PERCENT,
		)
		if (direction && current !== null && target === current)
			return okResult(
				`Voice volume already at ${current}%.`,
				phrase(
					ctx.sets,
					direction === DOMIA_VOLUME_DIRECTION_ENUM.UP
						? "voiceVolumeAtMax"
						: "voiceVolumeAtMin",
				),
				{ level: current },
			)
		const applied = await ctx.runtime.volume.set(ctx.domia, ctx.origin, target)
		if (applied === null)
			return errorResult(
				"This device has no controllable voice volume.",
				phrase(ctx.sets, "voiceVolumeUnavailable"),
			)
		const key =
			typeof args.level === "number"
				? "voiceVolumeSet"
				: direction === DOMIA_VOLUME_DIRECTION_ENUM.UP
					? "voiceVolumeUp"
					: "voiceVolumeDown"
		return okResult(
			`Voice volume set to ${applied}% (was ${current ?? "unknown"}).`,
			phrase(ctx.sets, key, { level: String(applied) }),
			{ level: applied, previous: current },
		)
	},
}
