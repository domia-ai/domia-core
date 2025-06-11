import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import { type SelectModuleSettingsType } from "@/db"

export const baseModuleSettings = (
	domiaId?: string,
): SelectModuleSettingsType => ({
	id: generateUuid(),
	name: faker.word.words(2),
	isActive: faker.datatype.boolean(),
	domiaId: domiaId ?? generateUuid(),
	emotionEngine: faker.datatype.boolean(),
	memoryEngine: faker.datatype.boolean(),
	collectiveMind: faker.datatype.boolean(),
	remoteAccessEngine: faker.datatype.boolean(),
	narrativeEngine: faker.datatype.boolean(),
	identityEngine: faker.datatype.boolean(),
	createdAt: now(),
	updatedAt: now(),
})
