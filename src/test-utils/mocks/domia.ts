import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import { type SelectDomiaType } from "@/db"

export const baseDomia: SelectDomiaType = {
	id: generateUuid(),
	name: faker.person.firstName(),
	domiaKey: `DOMIA-${faker.word.adjective()}-${faker.number.int(999)}`,
	isActive: true,
	sessionIdTimeoutMs: faker.number.int({ min: 150_000, max: 300_000 }),
	createdAt: now(),
	updatedAt: now(),
}
