import {
	type InsertDomiaType,
	type InsertRuntimeCapabilitiesType,
	type InsertCapabilityDelegationType,
	type InsertLlmModelConfigType,
	type InsertSkillProviderType,
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
		memoryWindowTurns: domia?.memoryWindowTurns,
		memoryMaxAgeMs: domia?.memoryMaxAgeMs,
		maxConcurrentVoiceReplies: domia?.maxConcurrentVoiceReplies,
		maxQueuedVoiceReplies: domia?.maxQueuedVoiceReplies,
		voiceQueueTimeoutMs: domia?.voiceQueueTimeoutMs,
		ownConfigTtlMs: domia?.ownConfigTtlMs,
		localIp: domia?.localIp,
		grpcPort: domia?.grpcPort,
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
		numPredict: llmModelConfig?.numPredict,
		llmConcurrency: llmModelConfig?.llmConcurrency,
		useCompactPrompt: llmModelConfig?.useCompactPrompt,
		reflectionModelName: llmModelConfig?.reflectionModelName,
		agentPromptMode: llmModelConfig?.agentPromptMode,
		skillsRouting: llmModelConfig?.skillsRouting,
		intentModelName: llmModelConfig?.intentModelName,
		agentMaxSteps: llmModelConfig?.agentMaxSteps,
	}
}

export const normalizeSkillProviders = (
	domia: DomiaType,
): InsertSkillProviderType[] | null => {
	const skillProviders = domia?.skillProviders
	if (!skillProviders?.length) {
		return null
	}

	return skillProviders?.map((skillProvider) => {
		return {
			id: skillProvider?.id,
			domiaId: domia?.id,
			name: skillProvider?.name,
			isActive: skillProvider?.isActive,
			protocol: skillProvider?.protocol,
			type: skillProvider?.type,
			url: skillProvider?.url,
			description: skillProvider?.description,
			config: skillProvider?.config,
			auth: skillProvider?.auth,
			toolsCache: skillProvider?.toolsCache,
			toolWhitelist: skillProvider?.toolWhitelist,
			lastSyncAt: skillProvider?.lastSyncAt,
			maxResultChars: skillProvider?.maxResultChars,
			timeout: skillProvider?.timeout,
			priority: skillProvider?.priority,
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
		quantization: sttConfig?.quantization,
		silenceThreshold: sttConfig?.silenceThreshold,
		bufferSize: sttConfig?.bufferSize,
		timeoutMs: sttConfig?.timeoutMs,
		enableEndpoint: sttConfig?.enableEndpoint,
		rule1MinTrailingSilence: sttConfig?.rule1MinTrailingSilence,
		rule2MinTrailingSilence: sttConfig?.rule2MinTrailingSilence,
		rule3MinUtteranceLength: sttConfig?.rule3MinUtteranceLength,
		numThreads: sttConfig?.numThreads,
		provider: sttConfig?.provider,
		decodePaddingMs: sttConfig?.decodePaddingMs,
		poolWarmWorkers: sttConfig?.poolWarmWorkers,
		poolMaxWorkers: sttConfig?.poolMaxWorkers,
		poolAutoScaleEnabled: sttConfig?.poolAutoScaleEnabled,
		poolIdleTimeoutMs: sttConfig?.poolIdleTimeoutMs,
		poolQueueMaxDepth: sttConfig?.poolQueueMaxDepth,
		poolQueueTimeoutMs: sttConfig?.poolQueueTimeoutMs,
		workerRecycleAfterJobs: sttConfig?.workerRecycleAfterJobs,
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
		modelPath: ttsConfig?.modelPath,
		quantization: ttsConfig?.quantization,
		pitch: ttsConfig?.pitch,
		speed: ttsConfig?.speed,
		silenceScale: ttsConfig?.silenceScale,
		numThreads: ttsConfig?.numThreads,
		provider: ttsConfig?.provider,
		maxNumSentences: ttsConfig?.maxNumSentences,
		streamingEnabled: ttsConfig?.streamingEnabled,
		poolWarmWorkers: ttsConfig?.poolWarmWorkers,
		poolMaxWorkers: ttsConfig?.poolMaxWorkers,
		poolAutoScaleEnabled: ttsConfig?.poolAutoScaleEnabled,
		poolIdleTimeoutMs: ttsConfig?.poolIdleTimeoutMs,
		poolQueueMaxDepth: ttsConfig?.poolQueueMaxDepth,
		poolQueueTimeoutMs: ttsConfig?.poolQueueTimeoutMs,
		workerRecycleAfterJobs: ttsConfig?.workerRecycleAfterJobs,
	}
}
