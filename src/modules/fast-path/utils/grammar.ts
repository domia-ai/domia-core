import { fold } from "./normalize"
import type { FastPathAstNodeType } from "../types"

const RESERVED = new Set(["(", ")", "[", "]", "{", "}", "<", ">", "|"])

const findClosing = (
	src: string,
	start: number,
	open: string,
	close: string,
): number => {
	let depth = 0
	for (let i = start; i < src.length; i++) {
		if (src[i] === open) depth++
		else if (src[i] === close) {
			depth--
			if (depth === 0) return i
		}
	}
	return -1
}

const splitAlternatives = (src: string): string[] => {
	const parts: string[] = []
	let depth = 0
	let current = ""
	for (const ch of src) {
		if (ch === "(" || ch === "[") depth++
		else if (ch === ")" || ch === "]") depth--
		if (ch === "|" && depth === 0) {
			parts.push(current)
			current = ""
		} else {
			current += ch
		}
	}
	parts.push(current)
	return parts
}

export const parseTemplate = (
	src: string,
	expansionRules: Record<string, string>,
): FastPathAstNodeType[] => {
	if (/\*|\.\+|\.\*/.test(src))
		throw new Error(`fast-path template may not contain wildcards: ${src}`)
	if (src.includes(";"))
		throw new Error(`fast-path template may not contain permutations: ${src}`)
	const nodes: FastPathAstNodeType[] = []
	let i = 0
	let textAcc = ""
	const flushText = (): void => {
		const t = fold(textAcc)
		if (t) nodes.push({ kind: "text", value: t })
		textAcc = ""
	}
	while (i < src.length) {
		const ch = src[i]
		if (ch === "(") {
			const end = findClosing(src, i, "(", ")")
			if (end < 0) throw new Error(`unbalanced ( in template: ${src}`)
			flushText()
			const inner = src.slice(i + 1, end)
			nodes.push({
				kind: "group",
				alternatives: splitAlternatives(inner).map((alt) =>
					parseTemplate(alt, expansionRules),
				),
			})
			i = end + 1
		} else if (ch === "[") {
			const end = findClosing(src, i, "[", "]")
			if (end < 0) throw new Error(`unbalanced [ in template: ${src}`)
			flushText()
			nodes.push({
				kind: "optional",
				body: parseTemplate(src.slice(i + 1, end), expansionRules),
			})
			i = end + 1
		} else if (ch === "{") {
			const end = src.indexOf("}", i)
			if (end < 0) throw new Error(`unbalanced { in template: ${src}`)
			flushText()
			const name = src.slice(i + 1, end).trim()
			if (!name) throw new Error(`empty slot in template: ${src}`)
			nodes.push({ kind: "slot", name })
			i = end + 1
		} else if (ch === "<") {
			const end = src.indexOf(">", i)
			if (end < 0) throw new Error(`unbalanced < in template: ${src}`)
			flushText()
			const ruleName = src.slice(i + 1, end).trim()
			const rule = expansionRules[ruleName]
			if (rule === undefined)
				throw new Error(`unknown expansion rule <${ruleName}> in: ${src}`)
			nodes.push(...parseTemplate(rule, expansionRules))
			i = end + 1
		} else if (RESERVED.has(ch)) {
			throw new Error(`unexpected "${ch}" in template: ${src}`)
		} else {
			textAcc += ch
			i++
		}
	}
	flushText()
	return nodes
}

const nodeHasLiteral = (node: FastPathAstNodeType): boolean => {
	if (node.kind === "text") return true
	if (node.kind === "group")
		return node.alternatives.every((alt) => alt.some(nodeHasLiteral))
	return false
}

export const lintTemplate = (ast: FastPathAstNodeType[], src: string): void => {
	if (!ast.some(nodeHasLiteral))
		throw new Error(
			`fast-path template must contain required literal text: ${src}`,
		)
	const slotInOptional = (
		nodes: FastPathAstNodeType[],
		inOptional: boolean,
	): boolean =>
		nodes.some((n) => {
			if (n.kind === "slot") return inOptional
			if (n.kind === "optional") return slotInOptional(n.body, true)
			if (n.kind === "group")
				return n.alternatives.some((alt) => slotInOptional(alt, inOptional))
			return false
		})
	if (slotInOptional(ast, false))
		throw new Error(
			`fast-path slots may not sit inside optionals (unstable slot set): ${src}`,
		)
}

export const prefilterOf = (
	ast: FastPathAstNodeType[],
): { pattern: string } => {
	const part = (nodes: FastPathAstNodeType[]): string =>
		nodes
			.map((n) => {
				if (n.kind === "text")
					return n.value
						.split(/\s+/)
						.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
						.join("[ ]+")
				if (n.kind === "slot") return "(?:.+)"
				if (n.kind === "optional") return `(?:[ ]*${part(n.body)})?`
				return `(?:${n.alternatives.map((alt) => part(alt)).join("|")})`
			})
			.filter(Boolean)
			.join("[ ]*")
	return { pattern: `^[ ]*${part(ast)}[ ]*$` }
}
