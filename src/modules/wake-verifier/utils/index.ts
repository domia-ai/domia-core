import { foldText, tokensOf } from "@/utils"
import type { WakePhraseMatchType } from "../types"

const NO_MATCH: WakePhraseMatchType = { score: 0, candidate: "" }

const squash = (text: string): string =>
	foldText(text).replace(/[^\p{L}\p{N}]+/gu, "")

const commonPrefixLength = (a: string, b: string): number => {
	const max = Math.min(a.length, b.length)
	let i = 0
	while (i < max && a[i] === b[i]) i++
	return i
}

export const matchWakePhrase = (
	transcript: string,
	wakePhrase: string,
): WakePhraseMatchType => {
	const target = squash(wakePhrase)
	if (target.length === 0) return NO_MATCH
	const whole = squash(transcript)
	if (whole.length === 0) return NO_MATCH
	if (whole.includes(target)) return { score: 1, candidate: target }

	const tokens = tokensOf(transcript, { minLength: 1 })
	if (tokens.length === 0) return NO_MATCH
	const maxWindow = Math.min(
		tokens.length,
		tokensOf(wakePhrase, { minLength: 1 }).length + 1,
	)

	let best = NO_MATCH
	for (let start = 0; start < tokens.length; start++) {
		for (
			let size = 1;
			size <= maxWindow && start + size <= tokens.length;
			size++
		) {
			const candidate = tokens.slice(start, start + size).join("")
			const score = commonPrefixLength(candidate, target) / target.length
			if (score > best.score) best = { score, candidate }
		}
	}
	return best
}
