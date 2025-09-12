import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import { type SelectCapabilityDelegationType, CAPABILITY_ENUM } from "@/db"

export const baseCapabilityDelegation = (
	domiaId?: string,
): SelectCapabilityDelegationType => {
	return {
		id: generateUuid(),
		domiaId: domiaId ?? generateUuid(),
		capability: CAPABILITY_ENUM.LLM,
		delegateToDomiaId: null,
		delegateToDomiaKey: `DOMIA-${faker.word.adjective()}-${faker.number.int(999)}`,
		priority: faker.number.int({ min: 0, max: 10 }),
		isActive: false,
		createdAt: now(),
		updatedAt: now(),
	}
}
