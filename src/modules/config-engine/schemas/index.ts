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

export const configSchema = z.object({
	domiaKey: z.string(),
	name: z.string().min(1),
	emotionEngine: z.boolean().default(true),
	memoryEngine: z.boolean().default(true),
	collectiveMind: z.boolean().default(true),
	remoteAccessEngine: z.boolean().default(true),
	narrativeEngine: z.boolean().default(true),
	identityEngine: z.boolean().default(true),
	emotion: emotionSchema.optional(),
	personality: z.enum(PERSONALITY_ENUM_VALUES).optional(),
	language: z.enum(["en", "es"]),
	languagesSpoken: z.array(z.string()),
	profession: z.enum(PROFESSION_ENUM_VALUES).optional(),
	communicationStyle: z.enum(COMMUNICATION_STYLE_ENUM_VALUES).optional(),
	perceivedAge: z.enum(PERCEIVED_AGE_ENUM_VALUES).optional(),
	culturalBackground: z.string().optional().default(""),
	knowledgeDepth: z.enum(KNOWLEDGE_DEPTH_ENUM_VALUES).optional(),
	interests: z.array(z.string()).default([]),
	hobbies: z.array(z.string()).default([]),
	skills: z.array(z.string()).default([]),
	relationshipType: z.enum(RELATIONSHIP_TYPE_ENUM_VALUES).optional(),
	roleMode: z.enum(ROLE_MODE_ENUM_VALUES).optional(),
	wifiSsid: z.string().optional().default(""),
	wifiPassword: z.string().optional().default(""),
})
