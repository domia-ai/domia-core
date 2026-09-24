import { FAST_PATH_CLOCK_NIGHT_PM_FROM_HOUR } from "@/db"

import { fold } from "./normalize"
import type {
	FastPathAstNodeType,
	CompiledSlotType,
	FastPathParseResultType,
	FastPathMatchStateType,
	NumberSetsType,
} from "../types"

const skipSpaces = (text: string, pos: number): number => {
	while (pos < text.length && text[pos] === " ") pos++
	return pos
}

const matchNodes = (
	text: string,
	nodes: FastPathAstNodeType[],
	nodeIdx: number,
	state: FastPathMatchStateType,
	slots: Map<string, CompiledSlotType>,
	results: FastPathMatchStateType[],
): void => {
	if (results.length > 0) return
	if (nodeIdx >= nodes.length) {
		if (text.slice(state.pos).trim().length === 0) results.push(state)
		return
	}
	const node = nodes[nodeIdx]
	const pos = skipSpaces(text, state.pos)
	if (node.kind === "text") {
		const literal = node.value
		if (text.startsWith(literal, pos)) {
			const after = pos + literal.length
			const boundary =
				after >= text.length || text[after] === " " || text[after - 1] === " "
			if (boundary)
				matchNodes(
					text,
					nodes,
					nodeIdx + 1,
					{
						...state,
						pos: after,
						literalChars: state.literalChars + literal.length,
						captures: state.captures,
					},
					slots,
					results,
				)
		}
		return
	}
	if (node.kind === "optional") {
		matchNodes(
			text,
			[...node.body, ...nodes.slice(nodeIdx + 1)],
			0,
			{ ...state, captures: new Map(state.captures) },
			slots,
			results,
		)
		if (results.length > 0) return
		matchNodes(text, nodes, nodeIdx + 1, state, slots, results)
		return
	}
	if (node.kind === "group") {
		for (const alt of node.alternatives) {
			matchNodes(
				text,
				[...alt, ...nodes.slice(nodeIdx + 1)],
				0,
				{ ...state, captures: new Map(state.captures) },
				slots,
				results,
			)
			if (results.length > 0) return
		}
		return
	}
	const slot = slots.get(node.name)
	if (!slot) return
	if (slot.kind === "range") {
		const numMatch = /^(\d+)/.exec(text.slice(pos))
		const parsed = numMatch
			? { value: Number(numMatch[1]), chars: numMatch[1].length }
			: wordNumberAt(text, pos)
		if (!parsed) return
		const { value, chars } = parsed
		if (value < slot.min || value > slot.max) return
		const captures = new Map(state.captures)
		captures.set(node.name, value)
		matchNodes(
			text,
			nodes,
			nodeIdx + 1,
			{
				...state,
				pos: pos + chars,
				slotChars: state.slotChars + chars,
				captures,
			},
			slots,
			results,
		)
		return
	}
	if (slot.kind === "duration" || slot.kind === "clockTime") {
		const parsed =
			slot.kind === "duration"
				? durationAt(text, pos, slot.maxSeconds)
				: clockTimeAt(text, pos)
		if (!parsed) return
		const captures = new Map(state.captures)
		captures.set(node.name, parsed.value)
		matchNodes(
			text,
			nodes,
			nodeIdx + 1,
			{
				...state,
				pos: pos + parsed.chars,
				slotChars: state.slotChars + parsed.chars,
				captures,
			},
			slots,
			results,
		)
		return
	}
	for (const value of slot.values) {
		if (!text.startsWith(value.folded, pos)) continue
		const after = pos + value.folded.length
		if (after < text.length && text[after] !== " ") continue
		const captures = new Map(state.captures)
		captures.set(node.name, value)
		matchNodes(
			text,
			nodes,
			nodeIdx + 1,
			{
				...state,
				pos: after,
				slotChars: state.slotChars + value.folded.length,
				captures,
			},
			slots,
			results,
		)
		if (results.length > 0) return
	}
}

const EMPTY_CLOCK_WORDS = {
	am: [],
	earlyMorning: [],
	pm: [],
	night: [],
	oclock: [],
	prefixes: [],
	halfBefore: [],
	quarterBefore: [],
	minusBefore: [],
	halfAfter: [],
	quarterAfter: [],
	minusAfter: [],
}

let activeNumbers: NumberSetsType = {
	words: {},
	joiners: [],
	durationUnits: {},
	durationPhrases: {},
	unitArticles: [],
	clockWords: EMPTY_CLOCK_WORDS,
	clockTwelveAm: "midnight",
}

const tokensFrom = (text: string, pos: number): string[] =>
	text.slice(pos).split(" ")

const charsOf = (tokens: string[], count: number): number =>
	tokens.slice(0, count).join(" ").length

const phraseIndexAt = (
	tokens: string[],
	index: number,
	phrases: string[],
): { tokens: number } | null => {
	const candidates = phrases
		.map((p) => fold(p).split(" ").filter(Boolean))
		.filter((p) => p.length > 0)
		.sort((a, b) => b.length - a.length)
	const hit = candidates.find((p) => p.every((t, k) => tokens[index + k] === t))
	return hit ? { tokens: hit.length } : null
}

const numberTokensAt = (
	tokens: string[],
	index: number,
): { value: number; tokens: number } | null => {
	const token = tokens[index]
	if (!token) return null
	if (/^\d+$/.test(token)) return { value: Number(token), tokens: 1 }
	if (activeNumbers.unitArticles.includes(token)) return { value: 1, tokens: 1 }
	const word = wordNumberAt(tokens.slice(index).join(" "), 0)
	if (!word) return null
	const consumed = tokens
		.slice(index)
		.join(" ")
		.slice(0, word.chars)
		.split(" ").length
	return { value: word.value, tokens: consumed }
}

const durationSegmentAt = (
	tokens: string[],
	index: number,
): { seconds: number; tokens: number } | null => {
	const amount = numberTokensAt(tokens, index)
	if (!amount) return null
	const unitToken = tokens[index + amount.tokens] ?? ""
	if (!Object.hasOwn(activeNumbers.durationUnits, unitToken)) return null
	return {
		seconds: amount.value * activeNumbers.durationUnits[unitToken],
		tokens: amount.tokens + 1,
	}
}

const durationAt = (
	text: string,
	pos: number,
	maxSeconds: number,
): { value: number; chars: number } | null => {
	const tokens = tokensFrom(text, pos)
	const phrases = Object.entries(activeNumbers.durationPhrases)
		.map(([phrase, seconds]) => ({
			tokens: fold(phrase).split(" ").filter(Boolean),
			seconds,
		}))
		.sort((a, b) => b.tokens.length - a.tokens.length)
	const phrase = phrases.find((p) => p.tokens.every((t, k) => tokens[k] === t))
	if (phrase)
		return phrase.seconds <= maxSeconds
			? { value: phrase.seconds, chars: charsOf(tokens, phrase.tokens.length) }
			: null
	const first = durationSegmentAt(tokens, 0)
	if (!first) return null
	let seconds = first.seconds
	let consumed = first.tokens
	while (tokens[consumed]) {
		const joined = activeNumbers.joiners.includes(tokens[consumed]) ? 1 : 0
		const next = durationSegmentAt(tokens, consumed + joined)
		if (!next) break
		seconds += next.seconds
		consumed += joined + next.tokens
	}
	if (seconds <= 0 || seconds > maxSeconds) return null
	return { value: seconds, chars: charsOf(tokens, consumed) }
}

const isBareArticle = (token: string): boolean =>
	activeNumbers.unitArticles.includes(token) &&
	!Object.hasOwn(activeNumbers.words, token)

const spokenMinutesAt = (
	tokens: string[],
	index: number,
): { value: number; tokens: number } | null => {
	const joined = activeNumbers.joiners.includes(tokens[index] ?? "") ? 1 : 0
	const at = index + joined
	if (isBareArticle(tokens[at] ?? "")) return null
	const parsed = numberTokensAt(tokens, at)
	if (!parsed || parsed.value >= 60) return null
	return { value: parsed.value, tokens: joined + parsed.tokens }
}

const nightHourOf = (hours: number): number => {
	if (hours === 12) return 0
	return hours >= FAST_PATH_CLOCK_NIGHT_PM_FROM_HOUR && hours < 12
		? hours + 12
		: hours
}

const clockTimeAt = (
	text: string,
	pos: number,
): { value: string; chars: number } | null => {
	const clock = activeNumbers.clockWords
	const tokens = tokensFrom(text, pos)
	let index = 0
	const take = (phrases: string[]): boolean => {
		const hit = phraseIndexAt(tokens, index, phrases)
		if (!hit) return false
		index += hit.tokens
		return true
	}
	take(clock.prefixes)
	let minutes: number | null = null
	let previousHour = false
	if (take(clock.minusBefore)) {
		minutes = 45
		previousHour = true
	} else if (take(clock.halfBefore)) minutes = 30
	else if (take(clock.quarterBefore)) minutes = 15
	const hour = numberTokensAt(tokens, index)
	if (!hour || hour.value < 0 || hour.value > 24) return null
	if (isBareArticle(tokens[index] ?? "")) return null
	index += hour.tokens
	if (minutes === null) {
		const next = tokens[index] ?? ""
		if (/^\d{2}$/.test(next) && Number(next) < 60) {
			minutes = Number(next)
			index++
		} else if (take(clock.minusAfter)) {
			minutes = 45
			previousHour = true
		} else if (take(clock.halfAfter)) minutes = 30
		else if (take(clock.quarterAfter)) minutes = 15
		else {
			const spoken = spokenMinutesAt(tokens, index)
			if (spoken) {
				minutes = spoken.value
				index += spoken.tokens
			} else {
				take(clock.oclock)
				minutes = 0
			}
		}
	}
	const pm = take(clock.pm)
	const night = pm ? false : take(clock.night)
	const early = pm || night ? false : take(clock.earlyMorning)
	const am = pm || night || early ? false : take(clock.am)
	let hours = previousHour ? (hour.value + 23) % 24 : hour.value
	if (pm && hours < 12) hours += 12
	if (night) hours = nightHourOf(hours)
	if (early && hours === 12) hours = 0
	if (am && hours === 12 && activeNumbers.clockTwelveAm === "midnight")
		hours = 0
	if (hours > 23) return null
	const pad = (n: number): string => String(n).padStart(2, "0")
	return {
		value: `${pad(hours)}:${pad(minutes)}`,
		chars: charsOf(tokens, index),
	}
}

const wordNumberAt = (
	text: string,
	pos: number,
): { value: number; chars: number } | null => {
	const tail = text.slice(pos)
	const tokens = tail.split(" ")
	const lookup = (token: string | undefined): number | undefined =>
		token ? activeNumbers.words[token] : undefined
	const t1 = tokens[0]
	const tens = lookup(t1)
	if (!t1 || tens === undefined) return null
	const joinerIdx =
		tokens[1] && activeNumbers.joiners.includes(tokens[1]) ? 2 : 1
	const unit = lookup(tokens[joinerIdx])
	if (
		tens >= 20 &&
		tens % 10 === 0 &&
		unit !== undefined &&
		unit >= 1 &&
		unit <= 9
	) {
		const chars = tokens.slice(0, joinerIdx + 1).join(" ").length
		return { value: tens + unit, chars }
	}
	return { value: tens, chars: t1.length }
}

export const matchTemplate = (
	utterance: string,
	ast: FastPathAstNodeType[],
	slots: Map<string, CompiledSlotType>,
	numbers?: NumberSetsType,
): FastPathParseResultType | null => {
	if (numbers) activeNumbers = numbers
	const text = fold(utterance)
	const results: FastPathMatchStateType[] = []
	matchNodes(
		text,
		ast,
		0,
		{ pos: 0, literalChars: 0, slotChars: 0, captures: new Map() },
		slots,
		results,
	)
	for (const r of results) {
		const rest = text.slice(r.pos).trim()
		if (rest.length === 0)
			return {
				consumed: true,
				literalChars: r.literalChars,
				slotChars: r.slotChars,
				captures: r.captures,
			}
	}
	return null
}
