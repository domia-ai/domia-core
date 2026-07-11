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
		desiredVolume: null,
		livekitApiKey: null,
		livekitApiSecret: null,
		livekitRoom: null,
		isActive: DEFAULT_SATELLITE_ACTIVE,
		createdAt: now(),
		updatedAt: now(),
	}
}
