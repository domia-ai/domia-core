import { languageSetsFor } from "./registry"
import type { AnaphoraLastActedType } from "./types"

export const anaphoraCandidate = (
	transcript: string,
	language?: string | null,
): boolean => {
	const trimmed = transcript.trim()
	return languageSetsFor(language).anaphoraRewrites.some((r) =>
		r.re.test(trimmed),
	)
}

export const applyAnaphora = (
	transcript: string,
	language: string | null | undefined,
	lastActed: AnaphoraLastActedType,
): string | null => {
	const trimmed = transcript.trim()
	for (const { re, template, kind } of languageSetsFor(language)
		.anaphoraRewrites) {
		if (kind !== null && kind !== lastActed.kind) continue
		const match = re.exec(trimmed)
		if (!match) continue
		let rewritten = template.replace("{entity}", lastActed.entity)
		for (let g = 1; g < match.length; g++)
			rewritten = rewritten.replace(`$${g}`, match[g] ?? "")
		return rewritten
	}
	return null
}
