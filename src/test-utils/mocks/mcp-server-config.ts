import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import { type SelectMcpServerConfigType } from "@/db"

export const baseMcpServerConfig = (
	domiaId?: string,
): SelectMcpServerConfigType => {
	return {
		id: generateUuid(),
		name: faker.hacker.abbreviation() + " MCP",
		isActive: true,
		domiaId: domiaId ?? generateUuid(),
		url: faker.internet.url(),
		description: faker.lorem.sentence(),
		timeout: faker.number.int({ min: 1000, max: 5000 }),
		priority: faker.number.int({ min: 0, max: 10 }),
		createdAt: now(),
		updatedAt: now(),
	}
}
