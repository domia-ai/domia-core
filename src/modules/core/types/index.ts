import {
	type SelectDomiaType,
	type SelectRuntimeCapabilitiesType,
	type SelectEmotionStateType,
	type SelectCharacterProfileType,
	type SelectModuleSettingsType,
	type SelectWakeWordConfigType,
	type SelectSttConfigType,
	type SelectLlmModelConfigType,
	type SelectTtsConfigType,
	type SelectMcpServerConfigType,
	type SelectAudioPlaybackConfigType,
	type SelectMqttConfigType,
	type SelectCapabilityDelegationType,
} from "@/db"

export type DomiaType = SelectDomiaType & {
	runtimeCapabilities: SelectRuntimeCapabilitiesType | null
	emotionState: SelectEmotionStateType | null
	characterProfile: SelectCharacterProfileType | null
	moduleSettings: SelectModuleSettingsType | null
	wakeWordConfig: SelectWakeWordConfigType | null
	sttConfig: SelectSttConfigType | null
	llmModelConfig: SelectLlmModelConfigType | null
	ttsConfig: SelectTtsConfigType | null
	audioPlaybackConfig: SelectAudioPlaybackConfigType | null
	mcpServerConfigs: SelectMcpServerConfigType[] | null
	localMqttConfig: SelectMqttConfigType | null
	capabilityDelegations: SelectCapabilityDelegationType[] | null
}

export type DomiaWithRawRelationsType = SelectDomiaType & {
	runtimeCapabilities: SelectRuntimeCapabilitiesType | null
	emotionState: SelectEmotionStateType | null
	characterProfiles: SelectCharacterProfileType[] | null
	moduleSettings: SelectModuleSettingsType[] | null
	wakeWordConfigs: SelectWakeWordConfigType[] | null
	sttConfigs: SelectSttConfigType[] | null
	llmModelConfigs: SelectLlmModelConfigType[] | null
	ttsConfigs: SelectTtsConfigType[] | null
	audioPlaybackConfigs: SelectAudioPlaybackConfigType[] | null
	mcpServerConfigs: SelectMcpServerConfigType[] | null
	mqttConfigs: SelectMqttConfigType[] | null
	capabilityDelegations: SelectCapabilityDelegationType[] | null
}
