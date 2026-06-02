import { z } from "zod"

import {
	PERSONALITY_ENUM_VALUES,
	PROFESSION_ENUM_VALUES,
	COMMUNICATION_STYLE_ENUM_VALUES,
	PERCEIVED_AGE_ENUM_VALUES,
	KNOWLEDGE_DEPTH_ENUM_VALUES,
	RELATIONSHIP_TYPE_ENUM_VALUES,
	ROLE_MODE_ENUM_VALUES,
} from "@/db"
import { emotionSchema } from "@/modules/emotion-engine"
import { promptOverridesSchema } from "@/modules/prompt-context-builder"

const mindCharacterSchema = z.object({
	name: z.string(),
	personality: z.enum(PERSONALITY_ENUM_VALUES),
	language: z.string(),
	profession: z.enum(PROFESSION_ENUM_VALUES),
	communicationStyle: z.enum(COMMUNICATION_STYLE_ENUM_VALUES),
	perceivedAge: z.enum(PERCEIVED_AGE_ENUM_VALUES),
	culturalBackground: z.string().nullish(),
	languagesSpoken: z.array(z.string()).nullish(),
	knowledgeDepth: z.enum(KNOWLEDGE_DEPTH_ENUM_VALUES),
	interests: z.array(z.string()).nullish(),
	hobbies: z.array(z.string()).nullish(),
	skills: z.array(z.string()).nullish(),
	relationshipType: z.enum(RELATIONSHIP_TYPE_ENUM_VALUES),
	roleMode: z.enum(ROLE_MODE_ENUM_VALUES),
	promptOverrides: promptOverridesSchema.nullish(),
})

const mindModulesSchema = z.object({
	emotionEngine: z.boolean(),
	memoryEngine: z.boolean(),
	collectiveMind: z.boolean(),
	remoteAccessEngine: z.boolean(),
	narrativeEngine: z.boolean(),
	identityEngine: z.boolean(),
})

export const mindSnapshotSchema = z.object({
	character: mindCharacterSchema,
	emotionBaseline: emotionSchema,
	modules: mindModulesSchema,
})
