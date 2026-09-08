import type { BenchStatsType } from "../types"

export const percentile = (xs: number[], p: number): number => {
	if (xs.length === 0) return 0
	const s = [...xs].sort((a, b) => a - b)
	const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)
	return s[Math.max(0, idx)]
}

export const stats = (xs: number[]): BenchStatsType => ({
	p50: percentile(xs, 50),
	p95: percentile(xs, 95),
	min: xs.length ? Math.min(...xs) : 0,
	max: xs.length ? Math.max(...xs) : 0,
})
