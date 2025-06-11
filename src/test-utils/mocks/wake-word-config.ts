import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import {
	DEFAULT_WAKE_WORD,
	DEFAULT_WAKE_WORD_MODEL,
	WAKE_WORD_ENGINE_ENUM,
	WAKE_WORD_FRAMEWORK_ENUM,
} from "@/db/constants"
import { type SelectWakeWordConfigType } from "@/db"

export const baseWakeWordConfig = (
	domiaId?: string,
): SelectWakeWordConfigType => {
	return {
		id: generateUuid(),
		name: faker.word.words(2),
		isActive: true,
		domiaId: domiaId ?? generateUuid(),
		engine: WAKE_WORD_ENGINE_ENUM.OPEN_WAKE_WORD,
		wakeWord: DEFAULT_WAKE_WORD,
		sensitivity: faker.number.float({ min: 0.3, max: 0.9 }),
		threshold: faker.number.float({ min: 0.3, max: 0.9 }),
		cooldown: faker.number.float({ min: 0.5, max: 5.0 }),
		framework: WAKE_WORD_FRAMEWORK_ENUM.ONNX,
		model: DEFAULT_WAKE_WORD_MODEL,
		customModelPath: null,
		inputDeviceIndex: faker.number.int({ min: 0, max: 3 }),
		createdAt: now(),
		updatedAt: now(),
	}
}
