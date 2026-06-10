import type {
	SelectDomiaType,
	SelectCharacterProfileType,
	SelectModuleSettingsType,
	SelectRuntimeCapabilitiesType,
	SelectSttConfigType,
	SelectTtsConfigType,
	SelectLlmModelConfigType,
	SelectWakeWordConfigType,
	SelectAudioPlaybackConfigType,
	SelectMqttConfigType,
	SelectMcpServerConfigType,
	SelectCapabilityDelegationType,
} from "@/db"
import type { z } from "zod"
import type { EmotionType } from "@/modules/emotion-engine"
import type { configBundleSchema } from "../schemas"

export type ConfigBundleType = z.infer<typeof configBundleSchema>

export type ConfigHealthEntryType = {
	stage: string
	engine: string | null
	configured: string | null
	path: string | null
	status: "ok" | "missing" | "unknown"
	detail?: string
}

export type ConfigHealthType = {
	ok: boolean
	entries: ConfigHealthEntryType[]
}

export type ConfigDomiaSectionType = Pick<
	SelectDomiaType,
	| "name"
	| "isActive"
	| "sessionIdTimeoutMs"
	| "memoryWindowTurns"
	| "memoryMaxAgeMs"
	| "maxConcurrentVoiceReplies"
	| "maxQueuedVoiceReplies"
	| "voiceQueueTimeoutMs"
	| "ownConfigTtlMs"
>

export type ConfigSnapshotType = {
	domia: ConfigDomiaSectionType
	character: SelectCharacterProfileType | null
	emotion: EmotionType | null
	modules: SelectModuleSettingsType | null
	capabilities: SelectRuntimeCapabilitiesType | null
	stt: SelectSttConfigType | null
	tts: SelectTtsConfigType | null
	llm: SelectLlmModelConfigType | null
	wakeWord: SelectWakeWordConfigType | null
	playback: SelectAudioPlaybackConfigType | null
	mqttLocal: SelectMqttConfigType | null
	mqttRemote: SelectMqttConfigType | null
	mcpServers: SelectMcpServerConfigType[]
	delegations: SelectCapabilityDelegationType[]
}
