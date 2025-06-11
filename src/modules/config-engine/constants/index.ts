import { env } from "@/config"
import {
	DEFAULT_EMOTION_PRESET,
	DEFAULT_PERSONALITY,
} from "@/modules/emotion-engine"
import {
	PROFESSION_ENUM,
	COMMUNICATION_STYLE_ENUM,
	PERCEIVED_AGE_ENUM,
	KNOWLEDGE_DEPTH_ENUM,
	RELATIONSHIP_TYPE_ENUM,
	ROLE_MODE_ENUM,
} from "@/db"

import type { ConfigType } from "../types"

export const DEFAULT_CONFIG_VALUES: ConfigType = {
	domiaKey: env.DOMIA_KEY,
	name: "Domia",
	emotionEngine: true,
	memoryEngine: true,
	collectiveMind: true,
	remoteAccessEngine: true,
	narrativeEngine: true,
	identityEngine: true,
	emotion: DEFAULT_EMOTION_PRESET,
	personality: DEFAULT_PERSONALITY,
	language: "en",
	languagesSpoken: ["en"],
	profession: PROFESSION_ENUM.HOST,
	communicationStyle: COMMUNICATION_STYLE_ENUM.NEUTRAL,
	perceivedAge: PERCEIVED_AGE_ENUM.ADULT,
	culturalBackground: "",
	knowledgeDepth: KNOWLEDGE_DEPTH_ENUM.INTERMEDIATE,
	interests: ["sports", "technology", "AI"],
	hobbies: ["soccer", "poker"],
	skills: ["programming"],
	relationshipType: RELATIONSHIP_TYPE_ENUM.COMPANION,
	roleMode: ROLE_MODE_ENUM.PASSIVE,
	wifiSsid: "",
	wifiPassword: "",
}
