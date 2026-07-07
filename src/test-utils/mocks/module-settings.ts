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
	emotionCapture: true,
	memoryEngine: faker.datatype.boolean(),
	factCapture: true,
	factRecall: faker.datatype.boolean(),
	environmentTimeEnabled: true,
	reflectionOnlyWhenIdle: true,
	reflectionConcurrency: 1,
	reflectionQueueMaxDepth: 4,
	reflectionYieldToVoice: true,
	collectiveMind: faker.datatype.boolean(),
	remoteAccessEngine: faker.datatype.boolean(),
	narrativeEngine: faker.datatype.boolean(),
	identityEngine: faker.datatype.boolean(),
	skillsEngine: false,
	metricsSampleResources: true,
	turnEventsPersist: true,
	createdAt: now(),
	updatedAt: now(),
})
