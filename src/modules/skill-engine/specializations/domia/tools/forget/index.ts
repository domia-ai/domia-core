import { z } from "zod"

import type { BuiltinToolType } from "../../../../types"
import {
	DOMIA_DESTRUCTIVE_HINTS,
	DOMIA_FORGET_TOPIC_MAX_CHARS,
	DOMIA_TOOL_FORGET,
} from "../../constants"
import { builtinToolPacks, okResult, phrase } from "../../packs"
import en from "./descriptors/en.json"
import es from "./descriptors/es.json"

export const forgetTool: BuiltinToolType = {
	name: DOMIA_TOOL_FORGET,
	definition: {
		name: DOMIA_TOOL_FORGET,
		description:
			"Forgets what you remember about the user on a topic, after they confirm. what = the topic in the user's own words (e.g. my favorite color, coffee, my job). Not for dismissing a request.",
		inputSchema: {
			type: "object",
			properties: {
				what: { type: "string", description: "The topic to forget" },
			},
			required: ["what"],
		},
		annotations: DOMIA_DESTRUCTIVE_HINTS,
	},
	schema: z
		.object({
			what: z.string().trim().min(1).max(DOMIA_FORGET_TOPIC_MAX_CHARS),
		})
		.strict(),
	packs: builtinToolPacks({ en, es }),
	policy: "confirm",
	execute: async (args, ctx) => {
		const what = args.what as string
		const expired = await ctx.runtime.facts.expire(ctx.domia, what)
		if (expired === 0)
			return okResult(
				`Nothing remembered about "${what}".`,
				phrase(ctx.sets, "nothingToForget", { what }),
			)
		if (ctx.interactionId)
			ctx.runtime.memory.markReflectionCaptured(ctx.interactionId)
		return okResult(
			`Forgot ${expired} fact(s) about "${what}".`,
			phrase(ctx.sets, "forgotThat"),
			{ what, expired },
		)
	},
}
