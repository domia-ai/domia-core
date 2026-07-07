export const EMOTION_TAG_SOURCE = String.raw`\[\s*(?:EMOTION\s*:\s*)?(joy|sadness|anger|fear|trust|disgust|anticipation|surprise)\s*(?::[^\]]{0,24})?\s*\]`

export const emotionTagPattern = (): RegExp =>
	new RegExp(EMOTION_TAG_SOURCE, "gi")

export const emotionTagLoosePattern = (): RegExp =>
	/\[\s*EMOTION\s*:[^\]]{0,40}\]/gi

export const collapseSpeechWhitespace = (text: string): string =>
	text
		.replace(/ {2,}/g, " ")
		.replace(/ ([,.!?;:])/g, "$1")
		.trim()
