import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import {
	type SelectSatelliteConfigType,
	DEFAULT_SATELLITE_PROTOCOL,
	DEFAULT_SATELLITE_PORT,
	DEFAULT_SATELLITE_ACTIVE,
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
		isActive: DEFAULT_SATELLITE_ACTIVE,
		createdAt: now(),
		updatedAt: now(),
	}
}
