import { faker } from "@faker-js/faker"

import {
	AUDIO_PLAYBACK_ENGINE_ENUM,
	DEFAULT_AUDIO_PLAYBACK_VOLUME,
	DEFAULT_AUDIO_PLAYBACK_STREAMING_ENABLED,
} from "@/db"
import { generateUuid, now } from "@/utils"

export const baseAudioPlaybackConfig = (domiaId?: string) => ({
	id: generateUuid(),
	name: faker.word.words(2),
	isActive: true,
	domiaId: domiaId ?? generateUuid(),
	engine: AUDIO_PLAYBACK_ENGINE_ENUM.SOX,
	volume: DEFAULT_AUDIO_PLAYBACK_VOLUME,
	streamingEnabled: DEFAULT_AUDIO_PLAYBACK_STREAMING_ENABLED,
	outputDevice: null,
	createdAt: now(),
	updatedAt: now(),
})
