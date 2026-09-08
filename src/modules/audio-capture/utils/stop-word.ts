import { languageSetsFor } from "@/utils"

const MAX_EXTRA_WORDS = 1

export const normalizeStopText = (text: string): string =>
	text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/^@/, "")
		.replace(/[_]+/g, " ")
		.replace(/[^\p{L}\p{N}'\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim()

export const matchStopPhrase = (
	text: string,
	language: string | null | undefined,
	maxWords: number,
): string | null => {
	const normalized = normalizeStopText(text)
	if (!normalized) return null
	const words = normalized.split(" ")
	if (words.length > maxWords) return null
	const phrases = languageSetsFor(language)
		.interruptPhrases.map(normalizeStopText)
		.filter((p) => p.length > 0)
		.sort((a, b) => b.length - a.length)
	for (const phrase of phrases) {
		const phraseWords = phrase.split(" ").length
		const extra = words.length - phraseWords
		if (extra < 0 || extra > MAX_EXTRA_WORDS) continue
		if (
			normalized === phrase ||
			normalized.startsWith(`${phrase} `) ||
			normalized.endsWith(` ${phrase}`)
		)
			return phrase
	}
	return null
}
