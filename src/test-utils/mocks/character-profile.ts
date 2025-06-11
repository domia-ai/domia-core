import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import {
	COMMUNICATION_STYLE_ENUM,
	KNOWLEDGE_DEPTH_ENUM,
	PERCEIVED_AGE_ENUM,
	PERSONALITY_ENUM,
	PROFESSION_ENUM,
	RELATIONSHIP_TYPE_ENUM,
	ROLE_MODE_ENUM,
	DEFAULT_LANGUAGE,
} from "@/db/constants"
import { type SelectCharacterProfileType } from "@/db"

export const baseCharacterProfile = (
	domiaId?: string,
): SelectCharacterProfileType => {
	return {
		id: generateUuid(),
		name: faker.person.firstName(),
		isActive: true,
		domiaId: domiaId ?? generateUuid(),
		personality: PERSONALITY_ENUM.NEUTRAL,
		language: DEFAULT_LANGUAGE,
		profession: PROFESSION_ENUM.HOST,
		communicationStyle: COMMUNICATION_STYLE_ENUM.FRIENDLY,
		perceivedAge: PERCEIVED_AGE_ENUM.ADULT,
		culturalBackground: faker.location.country(),
		languagesSpoken: [DEFAULT_LANGUAGE, faker.location.language()],
		knowledgeDepth: KNOWLEDGE_DEPTH_ENUM.INTERMEDIATE,
		interests: [faker.hacker.noun(), faker.music.genre()],
		hobbies: [faker.word.noun(), faker.word.noun()],
		skills: [faker.person.jobTitle(), faker.commerce.product()],
		relationshipType: RELATIONSHIP_TYPE_ENUM.COMPANION,
		roleMode: ROLE_MODE_ENUM.PASSIVE,
		createdAt: now(),
		updatedAt: now(),
	}
}
