import {
	type SelectDomiaType,
	type SelectEmotionStateType,
	type SelectCharacterProfileType,
	type SelectModuleSettingsType,
	type SelectWakeWordConfigType,
	type SelectSttConfigType,
	type SelectLlmModelConfigType,
	type SelectTtsConfigType,
	type SelectMcpServerConfigType,
	type SelectAudioPlaybackConfigType,
} from "@/db"

export type DomiaType = SelectDomiaType & {
	emotionState: SelectEmotionStateType | null
	characterProfile: SelectCharacterProfileType | null
	moduleSettings: SelectModuleSettingsType | null
	wakeWordConfig: SelectWakeWordConfigType | null
	sttConfig: SelectSttConfigType | null
	llmModelConfig: SelectLlmModelConfigType | null
	ttsConfig: SelectTtsConfigType | null
	audioPlaybackConfig: SelectAudioPlaybackConfigType | null
	mcpServerConfigs: SelectMcpServerConfigType[] | null
}

export type DomiaWithRawRelationsType = SelectDomiaType & {
	emotionState: SelectEmotionStateType | null
	characterProfiles: SelectCharacterProfileType[] | null
	moduleSettings: SelectModuleSettingsType[] | null
	wakeWordConfigs: SelectWakeWordConfigType[] | null
	sttConfigs: SelectSttConfigType[] | null
	llmModelConfigs: SelectLlmModelConfigType[] | null
	ttsConfigs: SelectTtsConfigType[] | null
	audioPlaybackConfigs: SelectAudioPlaybackConfigType[] | null
	mcpServerConfigs: SelectMcpServerConfigType[] | null
}
