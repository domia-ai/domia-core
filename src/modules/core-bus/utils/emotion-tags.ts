import { emotionTagPattern, collapseSpeechWhitespace } from "@/utils"
import type { ExtractedEmotionTagsType } from "../types"

export const extractEmotionTags = (text: string): ExtractedEmotionTagsType => {
	const tags: string[] = []
	const clean = collapseSpeechWhitespace(
		text.replace(emotionTagPattern(), (_, tag: string) => {
			tags.push(tag.toLowerCase())
			return ""
		}),
	)
	return { tags, clean }
}
