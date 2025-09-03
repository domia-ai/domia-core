import {
	type EmotionType,
	getEmotionVectorFromEmotionState,
	normalizeEmotionVector,
} from "@/modules/emotion-engine"
import { type DomiaType } from "@/modules/core"
import {
	type InsertCharacterProfileType,
	type InsertDomiaType,
	type InsertModuleSettingsType,
	type InsertEmotionStateType,
	type InsertWakeWordConfigType,
	type InsertSttConfigType,
	type InsertLlmModelConfigType,
	type InsertTtsConfigType,
	type InsertAudioPlaybackConfigType,
	type InsertMqttConfigType,
	type InsertRuntimeCapabilitiesType,
	MQTT_TYPE_ENUM,
} from "@/db"
import { generateUuid } from "@/utils"
import { getLocalIp } from "@/modules/heartbeat-manager"

import { type ConfigType } from "../types"
import { configSchema } from "../schemas"

export const getDomiaCreateInputFromConfig = (
	config: ConfigType,
): InsertDomiaType => {
	return {
		id: generateUuid(),
		name: config?.name,
		domiaKey: config?.domiaKey,
		localIp: getLocalIp(),
	}
}

export const getRuntimeCapabilitiesCreateInputFromConfig = (
	domiaId: string,
	config: ConfigType,
): InsertRuntimeCapabilitiesType => {
	return {
		id: generateUuid(),
		domiaId,
		wakeword: config?.wakeword,
		record: config?.record,
		stt: config?.stt,
		intentDetection: config?.intentDetection,
		intentExecution: config?.intentExecution,
		promptGeneration: config?.promptGeneration,
		llm: config?.llm,
		tts: config?.tts,
		playback: config?.playback,
	}
}

export const getCharacterProfileCreateInputFromConfig = (
	domiaId: string,
	config: ConfigType,
): InsertCharacterProfileType => {
	return {
		id: generateUuid(),
		name: "Default",
		isActive: true,
		domiaId,
		personality: config?.personality,
		language: config?.language,
		languagesSpoken: config?.languagesSpoken ?? [],
		profession: config?.profession,
		communicationStyle: config?.communicationStyle,
		perceivedAge: config?.perceivedAge,
		culturalBackground: config?.culturalBackground,
		knowledgeDepth: config?.knowledgeDepth,
		interests: config?.interests ?? [],
		hobbies: config?.hobbies ?? [],
		skills: config?.skills ?? [],
		relationshipType: config?.relationshipType,
		roleMode: config?.roleMode,
	}
}

export const getModuleSettingsCreateInputFromConfig = (
	domiaId: string,
	config: ConfigType,
): InsertModuleSettingsType => {
	return {
		id: generateUuid(),
		name: "Default",
		isActive: true,
		domiaId,
		emotionEngine: config?.emotionEngine,
		memoryEngine: config?.memoryEngine,
		collectiveMind: config?.collectiveMind,
		remoteAccessEngine: config?.remoteAccessEngine,
		narrativeEngine: config?.narrativeEngine,
		identityEngine: config?.identityEngine,
	}
}

export const getEmotionStateCreateInputFromConfig = (
	domiaId: string,
	config: ConfigType,
): InsertEmotionStateType => {
	const emotionVector = getEmotionVectorFromConfig(config)

	return {
		id: generateUuid(),
		domiaId,
		...emotionVector,
	}
}

export const getWakeWordConfigCreateInputFromConfig = (
	domiaId: string,
): InsertWakeWordConfigType => {
	return {
		id: generateUuid(),
		name: "Default",
		isActive: true,
		domiaId,
	}
}

export const getSttConfigCreateInputFromConfig = (
	domiaId: string,
): InsertSttConfigType => {
	return {
		id: generateUuid(),
		name: "Default",
		isActive: true,
		domiaId,
	}
}

export const getLlmModelConfigCreateInputFromConfig = (
	domiaId: string,
): InsertLlmModelConfigType => {
	return {
		id: generateUuid(),
		name: "Default",
		isActive: true,
		domiaId,
	}
}

export const getTtsConfigCreateInputFromConfig = (
	domiaId: string,
): InsertTtsConfigType => {
	return {
		id: generateUuid(),
		name: "Default",
		isActive: true,
		domiaId,
	}
}

export const getAudioPlaybackConfigCreateInputFromConfig = (
	domiaId: string,
): InsertAudioPlaybackConfigType => {
	return {
		id: generateUuid(),
		name: "Default",
		isActive: true,
		domiaId,
	}
}

export const getMqttConfigCreateInputFromConfig = (
	domiaId: string,
): InsertMqttConfigType => {
	return {
		id: generateUuid(),
		name: "Default",
		isActive: true,
		domiaId,
		type: MQTT_TYPE_ENUM.LOCAL,
		host: "localhost",
		username: "domia",
		password: "domia",
		topicRoot: "domia",
		protocol: "mqtt",
		port: 1883,
	}
}

export const getEmotionVectorFromConfig = (config: ConfigType): EmotionType => {
	return normalizeEmotionVector(config?.emotion)
}

export const getModuleValue = (moduleValue?: boolean) =>
	typeof moduleValue === "boolean" ? moduleValue : true

export const getDomiaConfig = (domia: DomiaType) => {
	const moduleSettings = domia?.moduleSettings
	const currentEmotion = getEmotionVectorFromEmotionState(domia?.emotionState)
	const characterProfile = domia?.characterProfile

	return configSchema.parse({
		domiaKey: domia?.domiaKey,
		name: domia?.name,
		emotionEngine: getModuleValue(moduleSettings?.emotionEngine),
		memoryEngine: getModuleValue(moduleSettings?.memoryEngine),
		collectiveMind: getModuleValue(moduleSettings?.collectiveMind),
		remoteAccessEngine: getModuleValue(moduleSettings?.remoteAccessEngine),
		narrativeEngine: getModuleValue(moduleSettings?.narrativeEngine),
		identityEngine: getModuleValue(moduleSettings?.identityEngine),
		emotion: currentEmotion,
		personality: characterProfile?.personality,
		language: characterProfile?.language as "en" | "es",
		languagesSpoken: (characterProfile?.languagesSpoken || []) as string[],
		profession: characterProfile?.profession,
		communicationStyle: characterProfile?.communicationStyle,
		perceivedAge: characterProfile?.perceivedAge,
		culturalBackground: characterProfile?.culturalBackground || "",
		knowledgeDepth: characterProfile?.knowledgeDepth,
		interests: (characterProfile?.interests || []) as string[],
		hobbies: (characterProfile?.hobbies || []) as string[],
		skills: (characterProfile?.skills || []) as string[],
		relationshipType: characterProfile?.relationshipType,
		roleMode: characterProfile?.roleMode,
		wifiSsid: "",
		wifiPassword: "",
	})
}
