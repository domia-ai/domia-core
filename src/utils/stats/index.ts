export const percentile = (xs: number[], p: number): number => {
	if (xs.length === 0) return 0
	const sorted = [...xs].sort((a, b) => a - b)
	const idx = Math.min(
		sorted.length - 1,
		Math.ceil((p / 100) * sorted.length) - 1,
	)
	return sorted[Math.max(0, idx)]
}
