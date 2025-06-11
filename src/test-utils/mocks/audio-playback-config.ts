import { faker } from "@faker-js/faker"

import { AUDIO_PLAYBACK_ENGINE_ENUM } from "@/db"
import { generateUuid, now } from "@/utils"

export const baseAudioPlaybackConfig = (domiaId?: string) => ({
	id: generateUuid(),
	name: faker.word.words(2),
	isActive: true,
	domiaId: domiaId ?? generateUuid(),
	engine: AUDIO_PLAYBACK_ENGINE_ENUM.SOX,
	volume: 100,
	outputDevice: null,
	createdAt: now(),
	updatedAt: now(),
})
