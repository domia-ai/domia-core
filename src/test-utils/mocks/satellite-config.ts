import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import {
	type SelectSatelliteConfigType,
	DEFAULT_SATELLITE_PROTOCOL,
	DEFAULT_SATELLITE_PORT,
	DEFAULT_SATELLITE_ACTIVE,
	DEFAULT_DESIRED_WAKE_WORDS,
	DEFAULT_SATELLITE_DESIRED_NUMBERS,
	DEFAULT_SATELLITE_FOLLOW_UP,
	DEFAULT_SATELLITE_FOLLOW_UP_NO_SPEECH_MS,
	DEFAULT_SATELLITE_PLAYBACK_DRAIN_MARGIN_MS,
	DEFAULT_SATELLITE_RUN_LISTENING_MAX_MS,
	DEFAULT_SATELLITE_FOLLOW_UP_REQUEST_MAX_MS,
	DEFAULT_SATELLITE_CAPTURE_HEAD_TRIM_MS,
} from "@/db"

export const baseSatelliteConfig = (
	domiaId?: string,
): SelectSatelliteConfigType => {
	return {
		id: generateUuid(),
		domiaId: domiaId ?? generateUuid(),
		satelliteId: `voice-pe-${faker.word.adjective()}`,
		name: `${faker.location.city()} Speaker`,
		host: faker.internet.ipv4(),
		port: DEFAULT_SATELLITE_PORT,
		encryptionKey: faker.string.alphanumeric(44),
		protocol: DEFAULT_SATELLITE_PROTOCOL,
		desiredWakeWords: DEFAULT_DESIRED_WAKE_WORDS,
		desiredNumbers: DEFAULT_SATELLITE_DESIRED_NUMBERS,
		followUpEnabled: DEFAULT_SATELLITE_FOLLOW_UP,
		followUpNoSpeechMs: DEFAULT_SATELLITE_FOLLOW_UP_NO_SPEECH_MS,
		playbackDrainMarginMs: DEFAULT_SATELLITE_PLAYBACK_DRAIN_MARGIN_MS,
		runListeningMaxMs: DEFAULT_SATELLITE_RUN_LISTENING_MAX_MS,
		followUpRequestMaxMs: DEFAULT_SATELLITE_FOLLOW_UP_REQUEST_MAX_MS,
		captureHeadTrimMs: DEFAULT_SATELLITE_CAPTURE_HEAD_TRIM_MS,
		desiredVolume: null,
		livekitApiKey: null,
		livekitApiSecret: null,
		livekitRoom: null,
		isActive: DEFAULT_SATELLITE_ACTIVE,
		createdAt: now(),
		updatedAt: now(),
	}
}
