import { foldText, tokensOf } from "@/utils/text-tokens"

export const nameScore = (
	query: string,
	candidate: string,
	generic: Set<string>,
	fullCoverageScore: number,
): number => {
	const qAll = tokensOf(query)
	const qSignal = qAll.filter((t) => !generic.has(t))
	const useSignal = qSignal.length > 0
	const q = new Set(useSignal ? qSignal : qAll)
	const cAll = tokensOf(candidate)
	const cSignal = cAll.filter((t) => !generic.has(t))
	const c = useSignal && cSignal.length > 0 ? cSignal : cAll
	if (q.size === 0 || c.length === 0) return 0
	let hits = 0
	for (const token of c) {
		for (const qt of q) {
			if (token === qt || token.startsWith(qt) || qt.startsWith(token)) {
				hits++
				break
			}
		}
	}
	if (!useSignal) return Math.min(1, hits / q.size)
	let covered = 0
	for (const qt of q) {
		for (const token of c) {
			if (token === qt || token.startsWith(qt) || qt.startsWith(token)) {
				covered++
				break
			}
		}
	}
	const ratio = hits / Math.max(q.size, c.length)
	return covered === q.size ? Math.max(ratio, fullCoverageScore) : ratio
}

export const stripTokens = (candidate: string, drop: Set<string>): string =>
	tokensOf(candidate)
		.filter((t) => !drop.has(t))
		.join(" ")

export const bestByName = <T>(
	candidates: readonly T[],
	namesOf: (candidate: T) => string[],
	query: string,
	generic: Set<string>,
	minScore: number,
	fullCoverageScore: number,
): T | null => {
	const folded = foldText(query)
	let best: { candidate: T; score: number } | null = null
	let tied = false
	for (const candidate of candidates) {
		let score = 0
		for (const name of namesOf(candidate)) {
			const current =
				foldText(name) === folded
					? 1
					: nameScore(query, name, generic, fullCoverageScore)
			score = Math.max(score, current)
		}
		if (score > (best?.score ?? 0)) {
			best = { candidate, score }
			tied = false
		} else if (best !== null && score === best.score && score > 0) {
			tied = true
		}
	}
	if (!best || best.score < minScore || tied) return null
	return best.candidate
}
