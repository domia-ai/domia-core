const normalizeWords = (s: string): string[] =>
	s
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s']/gu, " ")
		.split(/\s+/)
		.filter(Boolean)

export const wer = (reference: string, hypothesis: string): number => {
	const ref = normalizeWords(reference)
	const hyp = normalizeWords(hypothesis)
	if (ref.length === 0) return hyp.length === 0 ? 0 : 1
	const dp: number[][] = Array.from({ length: ref.length + 1 }, (_, i) =>
		Array.from({ length: hyp.length + 1 }, (_, j) =>
			i === 0 ? j : j === 0 ? i : 0,
		),
	)
	for (let i = 1; i <= ref.length; i++) {
		for (let j = 1; j <= hyp.length; j++) {
			const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1
			dp[i][j] = Math.min(
				dp[i - 1][j] + 1,
				dp[i][j - 1] + 1,
				dp[i - 1][j - 1] + cost,
			)
		}
	}
	return dp[ref.length][hyp.length] / ref.length
}
