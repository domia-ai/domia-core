import { z } from "zod"
import {
	interactionTrace,
	interactionSessionTrace,
	emotionEvent,
	memoryFact,
	announcement,
	turnEvent,
	type SelectRoutineType,
	type SelectToolRunType,
	type SelectMemoryEpisodeType,
	type SelectKnowledgeEntryType,
	type SelectUserModelType,
	type SelectFactEvidenceType,
	type SelectVoiceFeelAdjustmentType,
} from "@/db"
import {
	postChatBodySchema,
	postVoiceBodySchema,
	postSpeakBodySchema,
	postImportMindBodySchema,
	postImportMindBundleBodySchema,
	getMindExportQuerySchema,
	postKnowledgeBodySchema,
	getSyncQuerySchema,
	getAudioQuerySchema,
	postBenchRunBodySchema,
	postMeshRotateBodySchema,
	voiceFeelIdParamsSchema,
	postSatelliteTokenBodySchema,
	postFastPathTryBodySchema,
	getMemoryEpisodesQuerySchema,
	getFactEvidenceQuerySchema,
	getToolRunsQuerySchema,
	postConfirmationSettleBodySchema,
} from "../schemas"
import type { PendingConfirmationViewType } from "@/modules/agent"
import type { MeshSecretPostureType, MintedSatelliteTokenType } from "@/utils"
import type { PresenceEntryType, SpeakResultType } from "@/modules/core-bus"
import type { ConfigSnapshotType } from "@/modules/config"
import type {
	ConfigApplyResultType,
	ConfigApplyStateType,
} from "@/modules/config-apply"
import type { SkillProviderStatusType } from "@/modules/skill-engine"
import type { VoiceFeelAdjustmentViewType } from "@/modules/voice-feel"
import type { FastPathVerdictType } from "@/modules/fast-path"

export type GetConfigResponseType = {
	config: ConfigSnapshotType
	apply: ConfigApplyStateType
}

export type PostConfigResponseType = {
	config: ConfigSnapshotType
	apply: ConfigApplyResultType
	state: ConfigApplyStateType
}

export type GetSkillsResponseType = {
	skillsEngine: boolean
	builtinTools: boolean
	providers: SkillProviderStatusType[]
}

export type GetSkillDescriptorSchemaResponseType = {
	schema: Record<string, unknown>
	resourceUri: string
	serverAllowed: string[]
	stripped: string[]
	rejected: string[]
	limits: Record<string, number>
}

export type GetRoutinesResponseType = {
	routines: SelectRoutineType[]
}

export type PostRoutineResponseType = {
	routine: SelectRoutineType
	created: boolean
}

export type DeleteRoutineResponseType = {
	deleted: true
	id: string
}

export type PersistAnnouncementOptsType = {
	broadcastId: string
	text: string
	kind: "text" | "audio"
	delivery: "original" | "domia-voice"
	result: SpeakResultType
}

export type PresenceEntryResponseType = PresenceEntryType & {
	canIntercom: boolean
	canBroadcast: boolean
}

export type AgUiEventType = {
	event: string
	data: Record<string, unknown>
}

export type PostChatBodyType = z.infer<typeof postChatBodySchema>

export type PostChatResponseType = {
	interactionId: string
	reply: string
	audioUrl?: string | null
	timings?: PostVoiceTimingsType
}

export type PostChatRouteType = {
	Body: PostChatBodyType
}

export type GetAudioParamsType = {
	interactionId: string
}

export type GetAudioQueryType = z.input<typeof getAudioQuerySchema>

export type GetAudioRouteType = {
	Params: GetAudioParamsType
	Querystring: GetAudioQueryType
}

export type GetSyncQueryType = z.input<typeof getSyncQuerySchema>

export type GetSyncRouteType = {
	Querystring: GetSyncQueryType
}

export type GetInteractionRouteType = {
	Params: { interactionId: string }
	Querystring: { domiaKey?: string }
}

export type GetInteractionResponseType = {
	interaction: typeof interactionTrace.$inferSelect
}

export type SyncCursorType = { since: string; id: string }

export type GetSyncResponseType = {
	interactions: (typeof interactionTrace.$inferSelect)[]
	sessions: (typeof interactionSessionTrace.$inferSelect)[]
	emotionEvents: (typeof emotionEvent.$inferSelect)[]
	facts: (typeof memoryFact.$inferSelect)[]
	announcements: (typeof announcement.$inferSelect)[]
	turnEvents: (typeof turnEvent.$inferSelect)[]
	toolRuns: SelectToolRunType[]
	memoryEpisodes: SelectMemoryEpisodeType[]
	knowledgeEntries: SelectKnowledgeEntryType[]
	voiceFeelAdjustments: SelectVoiceFeelAdjustmentType[]
	factEvidence: SelectFactEvidenceType[]
	userModel: SelectUserModelType | null
	nextCursor: string
	nextTurnCursor: SyncCursorType | null
	nextFactsCursor: SyncCursorType | null
	nextToolCursor: SyncCursorType | null
	nextEpisodeCursor: SyncCursorType | null
	nextVoiceFeelCursor: SyncCursorType | null
	nextKnowledgeCursor: SyncCursorType | null
	nextEvidenceCursor: SyncCursorType | null
}

export type GetMemoryEpisodesQueryType = z.input<
	typeof getMemoryEpisodesQuerySchema
>

export type GetMemoryEpisodesRouteType = {
	Querystring: GetMemoryEpisodesQueryType
}

export type GetMemoryEpisodesResponseType = {
	episodes: SelectMemoryEpisodeType[]
}

export type GetUserModelResponseType = {
	userModel: SelectUserModelType | null
}

export type GetFactEvidenceQueryType = z.input<
	typeof getFactEvidenceQuerySchema
>

export type GetFactEvidenceRouteType = {
	Params: { factId: string }
	Querystring: GetFactEvidenceQueryType
}

export type GetFactEvidenceResponseType = {
	factId: string
	evidence: SelectFactEvidenceType[]
}

export type GetToolRunsQueryType = z.input<typeof getToolRunsQuerySchema>

export type GetToolRunsRouteType = {
	Querystring: GetToolRunsQueryType
}

export type GetToolRunsResponseType = {
	toolRuns: SelectToolRunType[]
}

export type GetConfirmationsResponseType = {
	confirmations: PendingConfirmationViewType[]
}

export type PostConfirmationSettleBodyType = z.infer<
	typeof postConfirmationSettleBodySchema
>

export type PostConfirmationSettleRouteType = {
	Params: { scope: string }
	Body: PostConfirmationSettleBodyType
	Querystring: { domiaKey?: string }
}

export type PostConfirmationSettleResponseType = {
	scope: string
	decision: PostConfirmationSettleBodyType["decision"]
	settled: boolean
	ran: boolean
	status: string | null
	text: string | null
}

export type PostVoiceBodyType = z.infer<typeof postVoiceBodySchema>

export type PostVoiceTimingsType = {
	sttMs: number
	llmMs: number
	ttsMs: number
	ttfaMs: number
	totalMs: number
}

export type PostVoiceResponseType = {
	interactionId: string
	transcript: string
	reply: string
	audioUrl: string | null
	timings: PostVoiceTimingsType
}

export type PostVoiceRouteType = {
	Body: PostVoiceBodyType
}

export type PostSpeakBodyType = z.infer<typeof postSpeakBodySchema>

export type SpeakWireResultType = {
	delivered: boolean
	target: SpeakResultType["target"]
	reason?: SpeakResultType["reason"]
	audioId?: string
}

export type PostSpeakRouteType = {
	Body: PostSpeakBodyType
}

export type PostKnowledgeBodyType = z.infer<
	ReturnType<typeof postKnowledgeBodySchema>
>

export type PostImportMindBodyType = z.infer<typeof postImportMindBodySchema>

export type PostImportMindBundleBodyType = z.infer<
	typeof postImportMindBundleBodySchema
>

export type GetMindExportQueryType = z.infer<typeof getMindExportQuerySchema>

export type PostImportMindRouteType = {
	Body: PostImportMindBodyType | PostImportMindBundleBodyType
}

export type TemplateIdParamsType = {
	id: string
}

export type TemplateIdRouteType = {
	Params: TemplateIdParamsType
}

export type PostBenchRunBodyType = z.infer<typeof postBenchRunBodySchema>

export type ConfigSchemaFieldKindType =
	| "boolean"
	| "number"
	| "string"
	| "enum"
	| "json"

export type ConfigSchemaFieldType = {
	key: string
	column: string
	type: ConfigSchemaFieldKindType
	default: unknown
	enumValues?: string[]
	nullable: boolean
	secret: boolean
}

export type ConfigSchemaSectionType = {
	id: string
	table: string
	fields: ConfigSchemaFieldType[]
}

export type ConfigSchemaType = {
	scalarSectionsOnly: true
	sections: ConfigSchemaSectionType[]
}

export type PostMeshRotateBodyType = z.infer<typeof postMeshRotateBodySchema>

export type PostMeshRotateResponseType = MeshSecretPostureType & {
	action: PostMeshRotateBodyType["action"]
}

export type VoiceFeelIdParamsType = z.infer<typeof voiceFeelIdParamsSchema>

export type VoiceFeelIdRouteType = {
	Params: VoiceFeelIdParamsType
}

export type VoiceFeelMutationResponseType = {
	adjustment: VoiceFeelAdjustmentViewType
	apply: ConfigApplyResultType
}

export type PostSatelliteTokenBodyType = z.infer<
	typeof postSatelliteTokenBodySchema
>

export type PostSatelliteTokenResponseType = MintedSatelliteTokenType

export type PostFastPathTryBodyType = z.infer<typeof postFastPathTryBodySchema>

export type PostFastPathTryResponseType = {
	verdict: FastPathVerdictType
}
