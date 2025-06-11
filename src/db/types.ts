import {
	type InferSelectModel,
	type InferInsertModel,
	ExtractTablesWithRelations,
} from "drizzle-orm"
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import Database from "better-sqlite3"
import { SQLiteTransaction } from "drizzle-orm/sqlite-core"

import * as schema from "./schema"
import {
	COMMUNICATION_STYLE_ENUM_VALUES,
	KNOWLEDGE_DEPTH_ENUM_VALUES,
	PERCEIVED_AGE_ENUM_VALUES,
	PERSONALITY_ENUM_VALUES,
	PROFESSION_ENUM_VALUES,
	RELATIONSHIP_TYPE_ENUM_VALUES,
	ROLE_MODE_ENUM_VALUES,
	WAKE_WORD_ENGINE_ENUM_VALUES,
	STT_ENGINE_ENUM_VALUES,
	LLM_ENGINE_ENUM_VALUES,
	TTS_ENGINE_ENUM_VALUES,
	WAKE_WORD_FRAMEWORK_ENUM_VALUES,
	INTERACTION_INPUT_TYPE_ENUM_VALUES,
	AUDIO_PLAYBACK_ENGINE_ENUM_VALUES,
} from "./constants"

export type DbClientType = BetterSQLite3Database<typeof schema> & {
	$client: Database.Database
}

export type DbTxType = SQLiteTransaction<
	"sync",
	Database.RunResult,
	typeof schema,
	ExtractTablesWithRelations<typeof schema>
>

export type DBClientOrTxType = DbClientType | DbTxType

export type SelectDomiaType = InferSelectModel<typeof schema.domia>
export type InsertDomiaType = InferInsertModel<typeof schema.domia>
export type UpdateDomiaType = Partial<Omit<InsertDomiaType, "id">> & {
	id: string
}

export type SelectEmotionStateType = InferSelectModel<
	typeof schema.emotionState
>
export type InsertEmotionStateType = InferInsertModel<
	typeof schema.emotionState
>
export type UpdateEmotionStateType = Partial<
	Omit<InsertEmotionStateType, "id">
> & {
	id: string
}

export type SelectCharacterProfileType = InferSelectModel<
	typeof schema.characterProfile
>
export type InsertCharacterProfileType = InferInsertModel<
	typeof schema.characterProfile
>
export type UpdateCharacterProfileType = Partial<
	Omit<InsertCharacterProfileType, "id">
> & {
	id: string
}

export type SelectModuleSettingsType = InferSelectModel<
	typeof schema.moduleSettings
>
export type InsertModuleSettingsType = InferInsertModel<
	typeof schema.moduleSettings
>
export type UpdateModuleSettingsType = Partial<
	Omit<InsertModuleSettingsType, "id">
> & {
	id: string
}

export type SelectAudioPlaybackConfigType = InferSelectModel<
	typeof schema.audioPlaybackConfig
>
export type InsertAudioPlaybackConfigType = InferInsertModel<
	typeof schema.audioPlaybackConfig
>
export type UpdateAudioPlaybackConfigType = Partial<
	Omit<InsertAudioPlaybackConfigType, "id">
> & {
	id: string
}

export type SelectEmotionEventType = InferSelectModel<
	typeof schema.emotionEvent
>
export type InsertEmotionEventType = InferInsertModel<
	typeof schema.emotionEvent
>
export type UpdateEmotionEventType = Partial<
	Omit<InsertEmotionEventType, "id">
> & {
	id: string
}

export type SelectWakeWordConfigType = InferSelectModel<
	typeof schema.wakeWordConfig
>
export type InsertWakeWordConfigType = InferInsertModel<
	typeof schema.wakeWordConfig
>
export type UpdateWakeWordConfigType = Partial<
	Omit<InsertWakeWordConfigType, "id">
> & {
	id: string
}

export type SelectSttConfigType = InferSelectModel<typeof schema.sttConfig>
export type InsertSttConfigType = InferInsertModel<typeof schema.sttConfig>
export type UpdateSttConfigType = Partial<Omit<InsertSttConfigType, "id">> & {
	id: string
}

export type SelectLlmModelConfigType = InferSelectModel<
	typeof schema.llmModelConfig
>
export type InsertLlmModelConfigType = InferInsertModel<
	typeof schema.llmModelConfig
>
export type UpdateLlmModelConfigType = Partial<
	Omit<InsertLlmModelConfigType, "id">
> & {
	id: string
}

export type SelectTtsConfigType = InferSelectModel<typeof schema.ttsConfig>
export type InsertTtsConfigType = InferInsertModel<typeof schema.ttsConfig>
export type UpdateTtsConfigType = Partial<Omit<InsertTtsConfigType, "id">> & {
	id: string
}

export type SelectMcpServerConfigType = InferSelectModel<
	typeof schema.mcpServerConfig
>
export type InsertMcpServerConfigType = InferInsertModel<
	typeof schema.mcpServerConfig
>
export type UpdateMcpServerConfigType = Partial<
	Omit<InsertMcpServerConfigType, "id">
> & { id: string }

export type SelectInteractionTraceType = InferSelectModel<
	typeof schema.interactionTrace
>
export type InsertInteractionTraceType = InferInsertModel<
	typeof schema.interactionTrace
>
export type UpdateInteractionTraceType = Partial<
	Omit<InsertInteractionTraceType, "id">
> & { id: string }

export type SelectInteractionSessionTraceType = InferSelectModel<
	typeof schema.interactionSessionTrace
>
export type InsertInteractionSessionTraceType = InferInsertModel<
	typeof schema.interactionSessionTrace
>
export type UpdateInteractionSessionTraceType = Partial<
	Omit<InsertInteractionSessionTraceType, "id">
> & { id: string }

export type WithParsedDatesType<T> = Omit<T, "createdAt" | "updatedAt"> & {
	createdAt: Date | null
	updatedAt: Date | null
}

export type PersonalityEnumType = (typeof PERSONALITY_ENUM_VALUES)[number]
export type ProfessionEnumType = (typeof PROFESSION_ENUM_VALUES)[number]
export type CommunicationStyleEnumType =
	(typeof COMMUNICATION_STYLE_ENUM_VALUES)[number]
export type PerceivedAgeEnumType = (typeof PERCEIVED_AGE_ENUM_VALUES)[number]
export type KnowledgeDepthEnumType =
	(typeof KNOWLEDGE_DEPTH_ENUM_VALUES)[number]
export type RelationshipTypeEnumType =
	(typeof RELATIONSHIP_TYPE_ENUM_VALUES)[number]
export type RoleModeEnumType = (typeof ROLE_MODE_ENUM_VALUES)[number]
export type WakeWordEngineEnumType =
	(typeof WAKE_WORD_ENGINE_ENUM_VALUES)[number]
export type SttEngineEnumType = (typeof STT_ENGINE_ENUM_VALUES)[number]
export type LlmEngineEnumType = (typeof LLM_ENGINE_ENUM_VALUES)[number]
export type TtsEngineEnumType = (typeof TTS_ENGINE_ENUM_VALUES)[number]
export type WakeWordFrameworkEnumType =
	(typeof WAKE_WORD_FRAMEWORK_ENUM_VALUES)[number]
export type AudioPlaybackEngineEnumType =
	(typeof AUDIO_PLAYBACK_ENGINE_ENUM_VALUES)[number]
export type InteractionInputTypeEnumType =
	(typeof INTERACTION_INPUT_TYPE_ENUM_VALUES)[number]
