export const EMOTION_TAG_SOURCE = String.raw`\[EMOTION:\s*([a-z]+)\s*\]`

export const emotionTagPattern = (): RegExp =>
	new RegExp(EMOTION_TAG_SOURCE, "gi")

export const collapseSpeechWhitespace = (text: string): string =>
	text
		.replace(/ {2,}/g, " ")
		.replace(/ ([,.!?;:])/g, "$1")
		.trim()
