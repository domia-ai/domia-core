import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import { type SelectMqttConfigType } from "@/db"

export const baseMqttConfig = (domiaId?: string): SelectMqttConfigType => ({
	id: generateUuid(),
	name: faker.word.words(2),
	isActive: true,
	domiaId: domiaId ?? generateUuid(),
	type: "LOCAL",
	host: "localhost",
	username: "domia",
	password: "domia",
	protocol: "mqtt",
	port: 1883,
	qos: 1,
	topicRoot: "domia",
	createdAt: now(),
	updatedAt: now(),
})
