import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import {
	type SelectSkillProviderType,
	DEFAULT_SKILL_MAX_RESULT_CHARS,
	MCP_TRANSPORT_ENUM,
	SKILL_PROTOCOL_ENUM,
} from "@/db"

export const baseSkillProvider = (
	domiaId?: string,
): SelectSkillProviderType => {
	return {
		id: generateUuid(),
		name: faker.hacker.abbreviation() + " MCP",
		isActive: true,
		domiaId: domiaId ?? generateUuid(),
		protocol: SKILL_PROTOCOL_ENUM.MCP,
		type: MCP_TRANSPORT_ENUM.HTTP,
		url: faker.internet.url(),
		description: faker.lorem.sentence(),
		config: null,
		descriptor: null,
		auth: null,
		toolsCache: null,
		toolWhitelist: null,
		lastSyncAt: null,
		maxResultChars: DEFAULT_SKILL_MAX_RESULT_CHARS,
		timeout: faker.number.int({ min: 1000, max: 5000 }),
		priority: faker.number.int({ min: 0, max: 10 }),
		createdAt: now(),
		updatedAt: now(),
	}
}
