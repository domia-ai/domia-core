import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import {
	type SelectMqttConfigType,
	DEFAULT_MQTT_PORT,
	DEFAULT_MQTT_QOS,
} from "@/db"

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
	port: DEFAULT_MQTT_PORT,
	qos: DEFAULT_MQTT_QOS,
	topicRoot: "domia",
	createdAt: now(),
	updatedAt: now(),
})
