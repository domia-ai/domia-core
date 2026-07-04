import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import { type SelectDomiaType } from "@/db"

export const baseDomia: SelectDomiaType = {
	id: generateUuid(),
	name: faker.person.firstName(),
	domiaKey: `DOMIA-${faker.word.adjective()}-${faker.number.int(999)}`,
	isActive: true,
	sessionIdTimeoutMs: faker.number.int({ min: 150_000, max: 300_000 }),
	memoryWindowTurns: 8,
	memoryMaxAgeMs: 1_800_000,
	maxConcurrentVoiceReplies: 2,
	maxQueuedVoiceReplies: 4,
	voiceQueueTimeoutMs: 15_000,
	ownConfigTtlMs: 30_000,
	warmupOnBoot: true,
	isHosted: true,
	lastSeenAt: null,
	peerNodeId: null,
	grpcUnaryDeadlineMs: 10_000,
	grpcStreamIdleTimeoutMs: 15_000,
	grpcStreamDeadlineMs: 60_000,
	peerStaleAfterMs: 90_000,
	configRevision: 0,
	configReloadDrainMs: 5_000,
	localIp: `192.168.${faker.number.int(255)}.${faker.number.int({ min: 1, max: 254 })}`,
	grpcPort: 5052,
	createdAt: now(),
	updatedAt: now(),
}
