import { z } from "zod"
import {
	postChatBodySchema,
	postVoiceBodySchema,
	postImportMindBodySchema,
} from "../schemas"

export type PostChatBodyType = z.infer<typeof postChatBodySchema>

export type PostChatResponseType = {
	reply: string
}

export type PostChatRouteType = {
	Body: PostChatBodyType
}

export type GetAudioParamsType = {
	interactionId: string
}

export type GetAudioRouteType = {
	Params: GetAudioParamsType
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
