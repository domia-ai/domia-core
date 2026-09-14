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
