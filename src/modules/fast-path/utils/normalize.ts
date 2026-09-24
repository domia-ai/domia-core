export const fold = (text: string): string =>
	text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[.,!?¡¿;:'"„“”]/g, " ")
		.replace(/\s+/g, " ")
		.trim()

export const tokensOf = (text: string): string[] =>
	fold(text).split(" ").filter(Boolean)

export const stripAdditiveCues = (folded: string, cues: string[]): string => {
	const cueTokens = cues
		.map((cue) => tokensOf(cue))
		.filter((tokens) => tokens.length > 0)
		.sort((a, b) => b.length - a.length)
	const tokens = folded.split(" ").filter(Boolean)
	const kept: string[] = []
	let index = 0
	while (index < tokens.length) {
		const cue = cueTokens.find((c) =>
			c.every((t, k) => tokens[index + k] === t),
		)
		if (cue) {
			index += cue.length
			continue
		}
		kept.push(tokens[index])
		index++
	}
	return kept.length > 0 ? kept.join(" ") : folded
}

const phraseAt = (
	tokens: string[],
	index: number,
	phrases: string[][],
): string[] | undefined =>
	phrases.find((p) => p.every((t, k) => tokens[index + k] === t))

const phraseEndingAt = (
	tokens: string[],
	end: number,
	phrases: string[][],
): string[] | undefined =>
	phrases.find(
		(p) =>
			end - p.length >= 0 &&
			p.every((t, k) => tokens[end - p.length + k] === t),
	)

export const stripSkipWords = (
	folded: string,
	skipWords: string[],
	maxPerSide: number,
): string => {
	const phrases = skipWords
		.map((w) => tokensOf(w))
		.filter((p) => p.length > 0)
		.sort((a, b) => b.length - a.length)
	const tokens = folded.split(" ").filter(Boolean)
	let start = 0
	let end = tokens.length
	for (let n = 0; n < maxPerSide && start < end; n++) {
		const hit = phraseAt(tokens, start, phrases)
		if (!hit || start + hit.length >= end) break
		start += hit.length
	}
	for (let n = 0; n < maxPerSide && end > start; n++) {
		const hit = phraseEndingAt(tokens, end, phrases)
		if (!hit || end - hit.length <= start) break
		end -= hit.length
	}
	const kept = tokens.slice(start, end)
	return kept.length > 0 ? kept.join(" ") : folded
}
