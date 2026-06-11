import {
	type EmotionType,
	normalizeEmotionVector,
} from "@/modules/emotion-engine"
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
import { getLocalIp } from "@/modules/network-sync"

import { type ConfigType } from "../types"

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
	}
}

export const getEmotionVectorFromConfig = (config: ConfigType): EmotionType => {
	return normalizeEmotionVector(config?.emotion)
}

export const getModuleValue = (moduleValue?: boolean) =>
	typeof moduleValue === "boolean" ? moduleValue : true
