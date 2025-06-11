import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import {
	TTS_ENGINE_ENUM,
	DEFAULT_TTS_VOICE_NAME,
	DEFAULT_LANGUAGE,
} from "@/db/constants"
import { type SelectTtsConfigType } from "@/db"

export const baseTtsConfig = (domiaId?: string): SelectTtsConfigType => {
	return {
		id: generateUuid(),
		name: faker.word.words(2),
		isActive: true,
		domiaId: domiaId ?? generateUuid(),
		engine: TTS_ENGINE_ENUM.PIPER,
		voiceName: DEFAULT_TTS_VOICE_NAME,
		language: DEFAULT_LANGUAGE,
		pitch: faker.number.float({ min: 0.8, max: 1.2 }),
		speed: faker.number.float({ min: 0.8, max: 1.2 }),
		createdAt: now(),
		updatedAt: now(),
	}
}
