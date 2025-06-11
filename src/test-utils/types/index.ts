import {
	type SelectCharacterProfileType,
	type SelectDomiaType,
	type SelectEmotionStateType,
	type SelectLlmModelConfigType,
	type SelectMcpServerConfigType,
	type SelectModuleSettingsType,
	type SelectSttConfigType,
	type SelectTtsConfigType,
	type SelectAudioPlaybackConfigType,
	type SelectWakeWordConfigType,
} from "@/db"

export type GetDomiaParamsType = {
	domiaOverrides?: Partial<SelectDomiaType>
	emotionStateOverrides?: Partial<SelectEmotionStateType>
	moduleSettingsOverrides?: Partial<SelectModuleSettingsType>
	characterProfileOverrides?: Partial<SelectCharacterProfileType>
	wakeWordConfigOverrides?: Partial<SelectWakeWordConfigType>
	sttConfigOverrides?: Partial<SelectSttConfigType>
	llmModelConfigOverrides?: Partial<SelectLlmModelConfigType>
	ttsConfigOverrides?: Partial<SelectTtsConfigType>
	audioPlaybackConfigOverrides?: Partial<SelectAudioPlaybackConfigType>
	mcpServerConfigOverrides?: Partial<SelectMcpServerConfigType>
}
