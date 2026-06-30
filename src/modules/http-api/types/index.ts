import { z } from "zod"
import {
	interactionTrace,
	interactionSessionTrace,
	emotionEvent,
	memoryFact,
	announcement,
} from "@/db"
import {
	postChatBodySchema,
	postVoiceBodySchema,
	postSpeakBodySchema,
	postImportMindBodySchema,
	getSyncQuerySchema,
	getAudioQuerySchema,
} from "../schemas"
import type { SpeakResultType } from "@/modules/core-bus"

export type PersistAnnouncementOptsType = {
	broadcastId: string
	text: string
	kind: "text" | "audio"
	delivery: "original" | "domia-voice"
	result: SpeakResultType
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

export type GetSyncResponseType = {
	interactions: (typeof interactionTrace.$inferSelect)[]
	sessions: (typeof interactionSessionTrace.$inferSelect)[]
	emotionEvents: (typeof emotionEvent.$inferSelect)[]
	facts: (typeof memoryFact.$inferSelect)[]
	announcements: (typeof announcement.$inferSelect)[]
	nextCursor: string
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
