import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import {
	TTS_ENGINE_ENUM,
	DEFAULT_TTS_VOICE_NAME,
	DEFAULT_TTS_MODEL_PATH,
	DEFAULT_TTS_NUM_THREADS,
	DEFAULT_TTS_PROVIDER,
	DEFAULT_TTS_MAX_NUM_SENTENCES,
	DEFAULT_TTS_SILENCE_SCALE,
	DEFAULT_TTS_SPEED,
	DEFAULT_TTS_STREAMING_ENABLED,
	DEFAULT_LANGUAGE,
} from "@/db/constants"
import { type SelectTtsConfigType } from "@/db"

export const baseTtsConfig = (domiaId?: string): SelectTtsConfigType => {
	return {
		id: generateUuid(),
		name: faker.word.words(2),
		isActive: true,
		domiaId: domiaId ?? generateUuid(),
		engine: TTS_ENGINE_ENUM.KOKORO,
		voiceName: DEFAULT_TTS_VOICE_NAME,
		language: DEFAULT_LANGUAGE,
		modelPath: DEFAULT_TTS_MODEL_PATH,
		quantization: null,
		pitch: faker.number.float({ min: 0.8, max: 1.2 }),
		speed: DEFAULT_TTS_SPEED,
		silenceScale: DEFAULT_TTS_SILENCE_SCALE,
		numThreads: DEFAULT_TTS_NUM_THREADS,
		provider: DEFAULT_TTS_PROVIDER,
		maxNumSentences: DEFAULT_TTS_MAX_NUM_SENTENCES,
		streamingEnabled: DEFAULT_TTS_STREAMING_ENABLED,
		createdAt: now(),
		updatedAt: now(),
	}
}
