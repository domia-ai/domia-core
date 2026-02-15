import { z } from "zod"
import { postChatBodySchema } from "../schemas"

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
