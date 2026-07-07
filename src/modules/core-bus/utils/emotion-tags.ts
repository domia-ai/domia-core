import {
	emotionTagPattern,
	emotionTagLoosePattern,
	collapseSpeechWhitespace,
} from "@/utils"
import type {
	ExtractedEmotionTagsType,
	SentenceEmotionTagsType,
} from "../types"

export const extractEmotionTags = (text: string): ExtractedEmotionTagsType => {
	const tags: string[] = []
	const clean = collapseSpeechWhitespace(
		text
			.replace(emotionTagPattern(), (_, tag: string) => {
				tags.push(tag.toLowerCase())
				return ""
			})
			.replace(emotionTagLoosePattern(), ""),
	)
	return { tags, clean }
}

export const splitSentenceEmotionTags = (
	sentence: string,
): SentenceEmotionTagsType => {
	const applyTags: string[] = []
	const carryTags: string[] = []
	const pattern = emotionTagPattern()
	let match: RegExpExecArray | null
	while ((match = pattern.exec(sentence)) !== null) {
		const tag = match[1].toLowerCase()
		const rest = sentence
			.slice(match.index + match[0].length)
			.replace(emotionTagPattern(), "")
		if (rest.trim() === "") carryTags.push(tag)
		else applyTags.push(tag)
	}
	return { applyTags, carryTags }
}
