import { z } from "zod"

import type { BuiltinToolType } from "../../../../types"
import { foldText } from "@/utils/text-tokens"
import { FACT_OWNED_SUBJECT_RELATION, FACT_SPEAKER_SUBJECT } from "@/db"

import {
	DOMIA_FACT_RELATION_MAX_CHARS,
	DOMIA_FACT_SUBJECT_MAX_CHARS,
	DOMIA_FACT_VALUE_MAX_CHARS,
	DOMIA_TOOL_REMEMBER,
	DOMIA_WRITE_HINTS,
} from "../../constants"
import {
	errorResult,
	builtinToolPacks,
	fillPlaceholders,
	okResult,
	phrase,
} from "../../packs"
import type { DomiaSpeakerFactType } from "../../types"
import en from "./descriptors/en.json"
import es from "./descriptors/es.json"

const speakerFactOf = (
	subject: string,
	relation: string,
	speakerSubjects: string[],
): DomiaSpeakerFactType => {
	const folded = foldText(subject)
	if (speakerSubjects.some((name) => foldText(name) === folded))
		return { subject: FACT_SPEAKER_SUBJECT, relation }
	return {
		subject: FACT_SPEAKER_SUBJECT,
		relation: fillPlaceholders(FACT_OWNED_SUBJECT_RELATION, {
			subject: subject.trim().toLowerCase(),
			relation,
		}),
	}
}

export const rememberTool: BuiltinToolType = {
	name: DOMIA_TOOL_REMEMBER,
	definition: {
		name: DOMIA_TOOL_REMEMBER,
		description:
			"When the user says remember that ..., you MUST call this tool with the fact; never just acknowledge it in words. Keeps one lasting fact about the user: name, tastes, allergies, family, pets, home, work. Not for requests, reminders or timers.",
		inputSchema: {
			type: "object",
			properties: {
				subject: { type: "string", description: "Always the word user" },
				relation: {
					type: "string",
					description:
						"Lowercase state phrase starting with is, has, likes, dislikes, prefers, loves, hates, lives, works, drinks, eats, plays, speaks, wants to. Keep the attribute: has favorite color, is named, is allergic to, has a sister named, lives in, works as",
				},
				value: {
					type: "string",
					description: "Only the detail: blue, Ana, nuts, Elena, Madrid",
				},
			},
			required: ["subject", "relation", "value"],
		},
		annotations: DOMIA_WRITE_HINTS,
	},
	schema: z
		.object({
			subject: z.string().trim().min(1).max(DOMIA_FACT_SUBJECT_MAX_CHARS),
			relation: z.string().trim().min(1).max(DOMIA_FACT_RELATION_MAX_CHARS),
			value: z.string().trim().min(1).max(DOMIA_FACT_VALUE_MAX_CHARS),
		})
		.strict(),
	packs: builtinToolPacks({ en, es }),
	execute: async (args, ctx) => {
		const value = args.value as string
		const { subject, relation } = speakerFactOf(
			args.subject as string,
			(args.relation as string).toLowerCase(),
			ctx.sets.speakerSubjects,
		)
		const result = await ctx.runtime.facts.upsert(ctx.domia, {
			subject,
			relation,
			value,
			evidenceInteractionId: ctx.interactionId,
		})
		if (!result.written)
			return errorResult(
				`Fact not stored${result.reason ? `: ${result.reason}` : ""}. Rephrase the relation as a state (e.g. "likes", "has favorite color", "is named").`,
				phrase(ctx.sets, "couldNotRemember"),
			)
		return okResult(
			`Remembered: ${subject} ${relation} ${value}.`,
			phrase(ctx.sets, "rememberedThat"),
			{ subject, relation, value },
		)
	},
}
