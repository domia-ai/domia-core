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
	type SelectRuntimeCapabilitiesType,
	type SelectMqttConfigType,
	type SelectCapabilityDelegationType,
} from "@/db"

export type GetDomiaParamsType = {
	domiaOverrides?: Partial<SelectDomiaType>
	runtimeCapabilitiesOverrides?: Partial<SelectRuntimeCapabilitiesType>
	emotionStateOverrides?: Partial<SelectEmotionStateType>
	moduleSettingsOverrides?: Partial<SelectModuleSettingsType>
	characterProfileOverrides?: Partial<SelectCharacterProfileType>
	wakeWordConfigOverrides?: Partial<SelectWakeWordConfigType>
	sttConfigOverrides?: Partial<SelectSttConfigType>
	llmModelConfigOverrides?: Partial<SelectLlmModelConfigType>
	ttsConfigOverrides?: Partial<SelectTtsConfigType>
	audioPlaybackConfigOverrides?: Partial<SelectAudioPlaybackConfigType>
	mcpServerConfigOverrides?: Partial<SelectMcpServerConfigType>
	mqttConfigOverrides?: Partial<SelectMqttConfigType>
	capabilityDelegationOverrides?: Partial<SelectCapabilityDelegationType>
}

export type VoiceCorpusEntryType = {
	id: string
	category: string
	text: string
	transcriptKeywords: string[]
	minReplyChars: number
	maxTotalMs: number
}

export type VoiceCorpusType = {
	version: number
	ttsEngine: string
	ttsVoice: string
	sampleRateHz: number
	entries: VoiceCorpusEntryType[]
}
