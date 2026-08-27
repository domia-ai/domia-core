import { fold } from "./normalize"
import type {
	FastPathAstNodeType,
	CompiledSlotType,
	FastPathSlotValueType,
	FastPathParseResultType,
} from "../types"

type StateType = {
	pos: number
	literalChars: number
	slotChars: number
	captures: Map<string, FastPathSlotValueType | number>
}

const skipSpaces = (text: string, pos: number): number => {
	while (pos < text.length && text[pos] === " ") pos++
	return pos
}

const matchNodes = (
	text: string,
	nodes: FastPathAstNodeType[],
	nodeIdx: number,
	state: StateType,
	slots: Map<string, CompiledSlotType>,
	results: StateType[],
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
		if (!numMatch) return
		const value = Number(numMatch[1])
		if (value < slot.min || value > slot.max) return
		const captures = new Map(state.captures)
		captures.set(node.name, value)
		matchNodes(
			text,
			nodes,
			nodeIdx + 1,
			{
				...state,
				pos: pos + numMatch[1].length,
				slotChars: state.slotChars + numMatch[1].length,
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

export const matchTemplate = (
	utterance: string,
	ast: FastPathAstNodeType[],
	slots: Map<string, CompiledSlotType>,
): FastPathParseResultType | null => {
	const text = fold(utterance)
	const results: StateType[] = []
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
