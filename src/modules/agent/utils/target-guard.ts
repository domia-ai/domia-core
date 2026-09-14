import { tokensOf } from "@/utils/text-tokens"
import type { ResolvedLanguageSetsType } from "@/utils/language-catalogs/types"
import type { ToolInvocationDescriptionType } from "@/modules/skill-engine"

const distinctiveTokens = (
	name: string,
	sets: ResolvedLanguageSetsType,
): string[] =>
	tokensOf(name, { stopwords: sets.stopwords }).filter(
		(t) => !sets.genericWords.has(t),
	)

export const targetMentioned = (
	transcript: string,
	described: ToolInvocationDescriptionType,
	sets: ResolvedLanguageSetsType,
	lastActedTarget?: string | null,
): boolean => {
	if (!described.target || described.implicit) return true
	const spoken = new Set([
		...tokensOf(transcript),
		...(lastActedTarget ? tokensOf(lastActedTarget) : []),
	])
	const names = described.targetNames ?? [described.target]
	const judged = names.map((n) => distinctiveTokens(n, sets))
	if (judged.every((tokens) => tokens.length === 0)) return true
	return judged.some((tokens) => tokens.some((t) => spoken.has(t)))
}
