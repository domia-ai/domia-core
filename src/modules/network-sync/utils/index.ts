import {
	type InsertDomiaType,
	type InsertRuntimeCapabilitiesType,
	type InsertCharacterProfileType,
	type InsertEmotionStateType,
	type InsertCapabilityDelegationType,
	type InsertLlmModelConfigType,
	type InsertMcpServerConfigType,
	type InsertSttConfigType,
	type InsertTtsConfigType,
} from "@/db"
import { type DomiaType } from "@/modules/core"

export const normalizeDomia = (domia: DomiaType): InsertDomiaType => {
	return {
		id: domia?.id,
		domiaKey: domia?.domiaKey,
		name: domia?.name,
		isActive: domia?.isActive,
		sessionIdTimeoutMs: domia?.sessionIdTimeoutMs,
		localIp: domia?.localIp,
	}
}

export const normalizeRuntimeCapabilities = (
	domia: DomiaType,
): InsertRuntimeCapabilitiesType | null => {
	const runtimeCapabilities = domia?.runtimeCapabilities
	if (!runtimeCapabilities) {
		return null
	}

	return {
		id: runtimeCapabilities?.id,
		domiaId: domia?.id,
		wakeword: runtimeCapabilities?.wakeword,
		record: runtimeCapabilities?.record,
		stt: runtimeCapabilities?.stt,
		intentDetection: runtimeCapabilities?.intentDetection,
		intentExecution: runtimeCapabilities?.intentExecution,
		promptGeneration: runtimeCapabilities?.promptGeneration,
		llm: runtimeCapabilities?.llm,
		tts: runtimeCapabilities?.tts,
		playback: runtimeCapabilities?.playback,
	}
}

export const normalizeCharacterProfile = (
	domia: DomiaType,
): InsertCharacterProfileType | null => {
	const characterProfile = domia?.characterProfile
	if (!characterProfile) {
		return null
	}

	return {
		id: characterProfile?.id,
		domiaId: domia?.id,
		name: characterProfile?.name,
		isActive: characterProfile?.isActive,
		personality: characterProfile?.personality,
		language: characterProfile?.language,
		profession: characterProfile?.profession,
		communicationStyle: characterProfile?.communicationStyle,
		perceivedAge: characterProfile?.perceivedAge,
		culturalBackground: characterProfile?.culturalBackground,
		languagesSpoken: characterProfile?.languagesSpoken,
		knowledgeDepth: characterProfile?.knowledgeDepth,
		interests: characterProfile?.interests,
		hobbies: characterProfile?.hobbies,
		skills: characterProfile?.skills,
		relationshipType: characterProfile?.relationshipType,
		roleMode: characterProfile?.roleMode,
	}
}

export const normalizeEmotionState = (
	domia: DomiaType,
): InsertEmotionStateType | null => {
	const emotionState = domia?.emotionState
	if (!emotionState) {
		return null
	}

	return {
		id: emotionState?.id,
		domiaId: domia?.id,
		joy: emotionState?.joy,
		sadness: emotionState?.sadness,
		anger: emotionState?.anger,
		fear: emotionState?.fear,
		trust: emotionState?.trust,
		disgust: emotionState?.disgust,
		anticipation: emotionState?.anticipation,
		surprise: emotionState?.surprise,
	}
}

export const normalizeCapabilityDelegations = (
	domia: DomiaType,
): InsertCapabilityDelegationType[] | null => {
	const capabilityDelegations = domia?.capabilityDelegations
	if (!capabilityDelegations?.length) {
		return null
	}

	return capabilityDelegations?.map((capabilityDelegation) => {
		return {
			id: capabilityDelegation?.id,
			domiaId: domia?.id,
			capability: capabilityDelegation?.capability,
			delegateToDomiaId: capabilityDelegation?.delegateToDomiaId,
			delegateToDomiaKey: capabilityDelegation?.delegateToDomiaKey,
			priority: capabilityDelegation?.priority,
			isActive: capabilityDelegation?.isActive,
		}
	})
}

export const normalizeLlmModelConfig = (
	domia: DomiaType,
): InsertLlmModelConfigType | null => {
	const llmModelConfig = domia?.llmModelConfig
	if (!llmModelConfig) {
		return null
	}

	return {
		id: llmModelConfig?.id,
		domiaId: domia?.id,
		name: llmModelConfig?.name,
		isActive: llmModelConfig?.isActive,
		engine: llmModelConfig?.engine,
		modelName: llmModelConfig?.modelName,
		temperature: llmModelConfig?.temperature,
		contextWindow: llmModelConfig?.contextWindow,
		useCompactPrompt: llmModelConfig?.useCompactPrompt,
	}
}

export const normalizeMcpServerConfigs = (
	domia: DomiaType,
): InsertMcpServerConfigType[] | null => {
	const mcpServerConfigs = domia?.mcpServerConfigs
	if (!mcpServerConfigs?.length) {
		return null
	}

	return mcpServerConfigs?.map((mcpServerConfig) => {
		return {
			id: mcpServerConfig?.id,
			domiaId: domia?.id,
			name: mcpServerConfig?.name,
			isActive: mcpServerConfig?.isActive,
			url: mcpServerConfig?.url,
			description: mcpServerConfig?.description,
			timeout: mcpServerConfig?.timeout,
			priority: mcpServerConfig?.priority,
		}
	})
}

export const normalizeSttConfig = (
	domia: DomiaType,
): InsertSttConfigType | null => {
	const sttConfig = domia?.sttConfig
	if (!sttConfig) {
		return null
	}

	return {
		id: sttConfig?.id,
		domiaId: domia?.id,
		name: sttConfig?.name,
		isActive: sttConfig?.isActive,
		engine: sttConfig?.engine,
		modelName: sttConfig?.modelName,
		language: sttConfig?.language,
		modelPath: sttConfig?.modelPath,
		silenceThreshold: sttConfig?.silenceThreshold,
		bufferSize: sttConfig?.bufferSize,
		timeoutMs: sttConfig?.timeoutMs,
	}
}

export const normalizeTtsConfig = (
	domia: DomiaType,
): InsertTtsConfigType | null => {
	const ttsConfig = domia?.ttsConfig
	if (!ttsConfig) {
		return null
	}

	return {
		id: ttsConfig?.id,
		domiaId: domia?.id,
		name: ttsConfig?.name,
		isActive: ttsConfig?.isActive,
		engine: ttsConfig?.engine,
		voiceName: ttsConfig?.voiceName,
		language: ttsConfig?.language,
		pitch: ttsConfig?.pitch,
		speed: ttsConfig?.speed,
	}
}
