import { z } from "zod"
import {
	interactionTrace,
	interactionSessionTrace,
	emotionEvent,
	memoryFact,
	announcement,
	turnEvent,
} from "@/db"
import {
	postChatBodySchema,
	postVoiceBodySchema,
	postSpeakBodySchema,
	postImportMindBodySchema,
	postKnowledgeBodySchema,
	getSyncQuerySchema,
	getAudioQuerySchema,
	postBenchRunBodySchema,
	postMeshRotateBodySchema,
} from "../schemas"
import type { MeshSecretPostureType } from "@/utils"
import type { SpeakResultType } from "@/modules/core-bus"
import type { ConfigSnapshotType } from "@/modules/config"
import type {
	ConfigApplyResultType,
	ConfigApplyStateType,
} from "@/modules/config-apply"

export type GetConfigResponseType = {
	config: ConfigSnapshotType
	apply: ConfigApplyStateType
}

export type PostConfigResponseType = {
	config: ConfigSnapshotType
	apply: ConfigApplyResultType
	state: ConfigApplyStateType
}

export type ProactivityIdentityType = {
	id: string
	domiaKey: string
}

export type PersistAnnouncementOptsType = {
	broadcastId: string
	text: string
	kind: "text" | "audio"
	delivery: "original" | "domia-voice"
	result: SpeakResultType
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

export type GetSyncResponseType = {
	interactions: (typeof interactionTrace.$inferSelect)[]
	sessions: (typeof interactionSessionTrace.$inferSelect)[]
	emotionEvents: (typeof emotionEvent.$inferSelect)[]
	facts: (typeof memoryFact.$inferSelect)[]
	announcements: (typeof announcement.$inferSelect)[]
	turnEvents: (typeof turnEvent.$inferSelect)[]
	nextCursor: string
	nextTurnCursor: { since: string; id: string } | null
	nextFactsCursor: { since: string; id: string } | null
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

export type PostSpeakResponseType = {
	delivered: boolean
	target: "satellite" | "local" | "none"
}

export type PostSpeakRouteType = {
	Body: PostSpeakBodyType
}

export type PostKnowledgeBodyType = z.infer<
	ReturnType<typeof postKnowledgeBodySchema>
>

export type PostImportMindBodyType = z.infer<typeof postImportMindBodySchema>

export type PostImportMindRouteType = {
	Body: PostImportMindBodyType
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
