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
	PERSONALITY_ENUM_VALUES,
	FACT_KIND_ENUM_VALUES,
	WAKE_WORD_ENGINE_ENUM_VALUES,
	VAD_ENGINE_ENUM_VALUES,
	TURN_DETECTOR_ENGINE_ENUM_VALUES,
	AEC_BACKEND_ENUM_VALUES,
	SPEECH_ENHANCER_ENGINE_ENUM_VALUES,
	WAKE_VERIFIER_ENUM_VALUES,
	EMBED_BACKEND_ENUM_VALUES,
	STT_ENGINE_ENUM_VALUES,
	LLM_ENGINE_ENUM_VALUES,
	TTS_ENGINE_ENUM_VALUES,
	AUDIO_PLAYBACK_ENGINE_ENUM_VALUES,
	CAPABILITY_ENUM_VALUES,
	IMPLICIT_FEEDBACK_ENUM_VALUES,
	ARG_NORMALIZE_OP_ENUM_VALUES,
	HARDWARE_CLASS_ENUM_VALUES,
	BENCH_STAGE_ENUM_VALUES,
	MCP_PROTOCOL_MODE_ENUM_VALUES,
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

export type SelectHostNodeType = InferSelectModel<typeof schema.hostNode>
export type InsertHostNodeType = InferInsertModel<typeof schema.hostNode>

export type SelectRuntimeCapabilitiesType = InferSelectModel<
	typeof schema.runtimeCapabilities
>
export type InsertRuntimeCapabilitiesType = InferInsertModel<
	typeof schema.runtimeCapabilities
>

export type SelectEmotionStateType = InferSelectModel<
	typeof schema.emotionState
>
export type InsertEmotionStateType = InferInsertModel<
	typeof schema.emotionState
>

export type SelectCharacterProfileType = InferSelectModel<
	typeof schema.characterProfile
>
export type InsertCharacterProfileType = InferInsertModel<
	typeof schema.characterProfile
>

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

export type SelectMqttConfigType = InferSelectModel<typeof schema.mqttConfig>
export type InsertMqttConfigType = InferInsertModel<typeof schema.mqttConfig>

export type InsertEmotionEventType = InferInsertModel<
	typeof schema.emotionEvent
>

export type SelectWakeWordConfigType = InferSelectModel<
	typeof schema.wakeWordConfig
>
export type InsertWakeWordConfigType = InferInsertModel<
	typeof schema.wakeWordConfig
>

export type SelectSttConfigType = InferSelectModel<typeof schema.sttConfig>
export type InsertSttConfigType = InferInsertModel<typeof schema.sttConfig>

export type SelectLlmModelConfigType = InferSelectModel<
	typeof schema.llmModelConfig
>
export type InsertLlmModelConfigType = InferInsertModel<
	typeof schema.llmModelConfig
>

export type SelectTtsConfigType = InferSelectModel<typeof schema.ttsConfig>
export type InsertTtsConfigType = InferInsertModel<typeof schema.ttsConfig>

export type {
	SkillAuthType,
	SkillToolType,
	SkillProviderConfigType,
	ToolFinalizeRuleType,
	ToolFinalizeMapType,
	ToolRunStatusType,
	ToolResultErrorCodeType,
	ToolTraceEntryType,
	SkillDescriptorLocaleType,
	SkillDescriptorRoutingType,
	DomiaSkillDescriptorType,
	ToolPolicyType,
	ToolAnnotationsType,
	ToolHintOverrideType,
	ToolRiskClassType,
	FastPathSlotType,
	FastPathIntentType,
	FastPathBlockType,
	RoutineStepType,
	BenchThresholdsType,
	ArgNormalizeMapType,
} from "./json-types"

export type ArgNormalizeOpType = (typeof ARG_NORMALIZE_OP_ENUM_VALUES)[number]
export type McpProtocolModeType = (typeof MCP_PROTOCOL_MODE_ENUM_VALUES)[number]
export type HardwareClassType = (typeof HARDWARE_CLASS_ENUM_VALUES)[number]
export type BenchStageType = (typeof BENCH_STAGE_ENUM_VALUES)[number]

export type SelectSkillProviderType = InferSelectModel<
	typeof schema.skillProvider
>
export type InsertSkillProviderType = InferInsertModel<
	typeof schema.skillProvider
>

export type SelectRoutineType = InferSelectModel<typeof schema.routine>
export type InsertRoutineType = InferInsertModel<typeof schema.routine>

export type SelectToolRunType = InferSelectModel<typeof schema.toolRun>
export type InsertToolRunType = InferInsertModel<typeof schema.toolRun>
export type ToolRunStatusEnumType = SelectToolRunType["status"]

export type SelectInteractionTraceType = InferSelectModel<
	typeof schema.interactionTrace
>
export type InsertInteractionTraceType = InferInsertModel<
	typeof schema.interactionTrace
>
export type UpdateInteractionTraceType = Partial<
	Omit<InsertInteractionTraceType, "id">
> & { id: string }

export type InsertInteractionSessionTraceType = InferInsertModel<
	typeof schema.interactionSessionTrace
>
export type UpdateInteractionSessionTraceType = Partial<
	Omit<InsertInteractionSessionTraceType, "id">
> & { id: string }

export type SelectSatelliteConfigType = InferSelectModel<
	typeof schema.satelliteConfig
>
export type InsertSatelliteConfigType = InferInsertModel<
	typeof schema.satelliteConfig
>

export type SelectCapabilityDelegationType = InferSelectModel<
	typeof schema.capabilityDelegation
>
export type InsertCapabilityDelegationType = InferInsertModel<
	typeof schema.capabilityDelegation
>

export type SelectMemoryFactType = InferSelectModel<typeof schema.memoryFact>
export type InsertMemoryFactType = InferInsertModel<typeof schema.memoryFact>

export type SelectFactEvidenceType = InferSelectModel<
	typeof schema.factEvidence
>
export type InsertFactEvidenceType = InferInsertModel<
	typeof schema.factEvidence
>

export type SelectKnowledgeEntryType = InferSelectModel<
	typeof schema.knowledgeEntry
>
export type InsertKnowledgeEntryType = InferInsertModel<
	typeof schema.knowledgeEntry
>

export type SelectMemoryEpisodeType = InferSelectModel<
	typeof schema.memoryEpisode
>
export type InsertMemoryEpisodeType = InferInsertModel<
	typeof schema.memoryEpisode
>
export type SelectUserModelType = InferSelectModel<typeof schema.userModel>
export type InsertUserModelType = InferInsertModel<typeof schema.userModel>

export type InsertAnnouncementType = InferInsertModel<
	typeof schema.announcement
>

export type InsertTurnEventType = InferInsertModel<typeof schema.turnEvent>

export type SelectVoiceFeelAdjustmentType = InferSelectModel<
	typeof schema.voiceFeelAdjustment
>
export type InsertVoiceFeelAdjustmentType = InferInsertModel<
	typeof schema.voiceFeelAdjustment
>

export type SelectProactiveScheduleType = InferSelectModel<
	typeof schema.proactiveSchedule
>
export type InsertProactiveScheduleType = InferInsertModel<
	typeof schema.proactiveSchedule
>

export type PersonalityEnumType = (typeof PERSONALITY_ENUM_VALUES)[number]
export type FactKindEnumType = (typeof FACT_KIND_ENUM_VALUES)[number]
export type WakeWordEngineEnumType =
	(typeof WAKE_WORD_ENGINE_ENUM_VALUES)[number]
export type VadEngineEnumType = (typeof VAD_ENGINE_ENUM_VALUES)[number]
export type AecBackendEnumType = (typeof AEC_BACKEND_ENUM_VALUES)[number]
export type SpeechEnhancerEngineEnumType =
	(typeof SPEECH_ENHANCER_ENGINE_ENUM_VALUES)[number]
export type WakeVerifierEnumType = (typeof WAKE_VERIFIER_ENUM_VALUES)[number]
export type TurnDetectorEngineEnumType =
	(typeof TURN_DETECTOR_ENGINE_ENUM_VALUES)[number]
export type EmbedBackendEnumType = (typeof EMBED_BACKEND_ENUM_VALUES)[number]
export type SttEngineEnumType = (typeof STT_ENGINE_ENUM_VALUES)[number]
export type LlmEngineEnumType = (typeof LLM_ENGINE_ENUM_VALUES)[number]
export type TtsEngineEnumType = (typeof TTS_ENGINE_ENUM_VALUES)[number]
export type AudioPlaybackEngineEnumType =
	(typeof AUDIO_PLAYBACK_ENGINE_ENUM_VALUES)[number]
export type CapabilityEnumType = (typeof CAPABILITY_ENUM_VALUES)[number]
export type ImplicitFeedbackType =
	(typeof IMPLICIT_FEEDBACK_ENUM_VALUES)[number]
