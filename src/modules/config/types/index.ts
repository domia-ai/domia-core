import { mqttConfig } from "@/db"
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
	| "sessionIdTimeoutMs"
	| "memoryWindowTurns"
	| "memoryMaxAgeMs"
	| "maxConcurrentVoiceReplies"
	| "maxQueuedVoiceReplies"
	| "voiceQueueTimeoutMs"
	| "ownConfigTtlMs"
	| "warmupOnBoot"
>

export type SectionMetaKeyType =
	| "id"
	| "domiaId"
	| "isActive"
	| "createdAt"
	| "updatedAt"

export type BundleSectionType<T> = Omit<T, Extract<keyof T, SectionMetaKeyType>>

export type ConfigSnapshotType = {
	version: number
	domia: ConfigDomiaSectionType
	character: BundleSectionType<SelectCharacterProfileType> | null
	emotion: EmotionType | null
	modules: BundleSectionType<SelectModuleSettingsType> | null
	capabilities: BundleSectionType<SelectRuntimeCapabilitiesType> | null
	stt: BundleSectionType<SelectSttConfigType> | null
	tts: BundleSectionType<SelectTtsConfigType> | null
	llm: BundleSectionType<SelectLlmModelConfigType> | null
	wakeWord: BundleSectionType<SelectWakeWordConfigType> | null
	playback: BundleSectionType<SelectAudioPlaybackConfigType> | null
	mqttLocal: Omit<
		BundleSectionType<SelectMqttConfigType>,
		"type" | "password"
	> | null
	mcpServers: BundleSectionType<SelectMcpServerConfigType>[]
	delegations: BundleSectionType<SelectCapabilityDelegationType>[]
}

export type MqttSectionType = (typeof mqttConfig.$inferSelect)["type"]
