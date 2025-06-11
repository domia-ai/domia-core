import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import {
	STT_ENGINE_ENUM,
	DEFAULT_STT_MODEL_NAME,
	DEFAULT_LANGUAGE,
} from "@/db/constants"
import { type SelectSttConfigType } from "@/db"

export const baseSttConfig = (domiaId?: string): SelectSttConfigType => {
	return {
		id: generateUuid(),
		name: faker.word.words(2),
		isActive: true,
		domiaId: domiaId ?? generateUuid(),
		engine: STT_ENGINE_ENUM.VOSK,
		modelName: DEFAULT_STT_MODEL_NAME,
		language: DEFAULT_LANGUAGE,
		modelPath: null,
		silenceThreshold: faker.number.float({ min: 0.01, max: 0.2 }),
		bufferSize: faker.number.int({ min: 1024, max: 8192 }),
		timeoutMs: faker.number.int({ min: 3000, max: 10000 }),
		createdAt: now(),
		updatedAt: now(),
	}
}
