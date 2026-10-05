import { DEFAULT_INTENT_MODEL } from "@/db"
import type { DomiaType } from "@/modules/core"
import { runLLMChoice, type LlmChoiceRequestType } from "@/modules/llm-engine"
import { intentRouterLogger, parseLlmJson, languageSetsFor } from "@/utils"

import {
	TOOL_JUDGE_DESCRIPTION_MAX_CHARS,
	TOOL_JUDGE_KEY,
	TOOL_JUDGE_NONE,
	TOOL_JUDGE_PROMPT_MAX_CHARS,
	TOOL_JUDGE_SYSTEM,
	TOOL_JUDGE_TRIMMED_EXAMPLES,
} from "../constants"
import {
	isIntentCacheEnabled,
	judgeCacheScope,
	lookupJudgeCache,
	rememberJudgeVerdict,
} from "../utils"
import type {
	IntentToolHintType,
	ToolJudgeRemoteType,
	ToolJudgeVerdictType,
} from "../types"

const escapeRe = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const routingBlockerHit = (
	transcript: string,
	language: string | null | undefined,
): string | null => {
	const folded = transcript.toLowerCase()
	for (const blocker of languageSetsFor(language ?? null).routingBlockers) {
		const re = new RegExp(
			`(^|[\\s,;¡¿"'(])${escapeRe(blocker)}([\\s,;.!?"')]|$)`,
			"i",
		)
		if (re.test(folded)) return blocker
	}
	return null
}

const foldMarker = (v: string): string =>
	v.toLowerCase().replace(/[‘’ʼ]/g, "'").normalize("NFD").replace(/\p{M}/gu, "")

const markerHit = (transcript: string, markers: string[]): string | null => {
	const folded = foldMarker(transcript)
	for (const marker of markers)
		if (folded.includes(foldMarker(marker))) return marker
	return null
}

export const personalQuestionHit = (
	transcript: string,
	language: string | null | undefined,
): string | null =>
	markerHit(
		transcript,
		languageSetsFor(language ?? null).personalQuestionMarkers,
	)

const capped = (text: string): string =>
	text.length > TOOL_JUDGE_DESCRIPTION_MAX_CHARS
		? `${text.slice(0, TOOL_JUDGE_DESCRIPTION_MAX_CHARS - 1).trimEnd()}…`
		: text

const firstSentence = (text: string): string => {
	const end = text.search(/[.!?](\s|$)/)
	return end === -1 ? text : text.slice(0, end + 1)
}

const judgeLine = (
	tool: IntentToolHintType,
	describe: (description: string) => string | null,
	maxExamples: number | null,
): string => {
	const examples =
		maxExamples === null ? tool.examples : tool.examples?.slice(0, maxExamples)
	const description = tool.description?.trim()
		? describe(tool.description.trim())
		: null
	const shown = examples?.length ? ` Examples: ${examples.join("; ")}` : ""
	return `- ${tool.name}:${description ? ` ${description}` : ""}${shown}`
}

const judgeSystemOf = (tools: IntentToolHintType[]): string | null => {
	const whole = (d: string): string => capped(d)
	const brief = (d: string): string => capped(firstSentence(d))
	const attempts: [
		(tool: IntentToolHintType) => (d: string) => string | null,
		number | null,
	][] = [
		[() => whole, null],
		[() => brief, null],
		[(t) => (t.examples?.length ? () => null : brief), null],
		[
			(t) => (t.examples?.length ? () => null : brief),
			TOOL_JUDGE_TRIMMED_EXAMPLES,
		],
	]
	for (const [describeFor, maxExamples] of attempts) {
		const lines = tools.map((t) => judgeLine(t, describeFor(t), maxExamples))
		const system = `${TOOL_JUDGE_SYSTEM}\n\nTools:\n${lines.join("\n")}`
		if (system.length <= TOOL_JUDGE_PROMPT_MAX_CHARS) return system
	}
	return null
}

export const judgeRequestOf = (
	transcript: string,
	tools: IntentToolHintType[],
): LlmChoiceRequestType | null => {
	const system = judgeSystemOf(tools)
	return system === null
		? null
		: {
				system,
				user: transcript,
				key: TOOL_JUDGE_KEY,
				choices: [...tools.map((t) => t.name), TOOL_JUDGE_NONE],
			}
}

const remoteChoice = async (
	remote: ToolJudgeRemoteType,
	request: LlmChoiceRequestType,
): Promise<string | null> => {
	const raw = await remote(request)
	const chosen = raw == null ? null : parseLlmJson(raw).value?.[request.key]
	return typeof chosen === "string" && request.choices.includes(chosen)
		? chosen
		: null
}

export const requestedToolOf = async (
	domia: DomiaType,
	transcript: string,
	tools: IntentToolHintType[],
	remote?: ToolJudgeRemoteType,
): Promise<ToolJudgeVerdictType> => {
	if (tools.length === 0) return { tool: null, failed: false }
	const started = Date.now()
	const request = judgeRequestOf(transcript, tools)
	if (request === null) {
		intentRouterLogger.warn(
			"tool judge skipped — the tool catalog exceeds the prompt budget",
			{ domiaId: domia.id, tools: tools.length },
		)
		return { tool: null, failed: true }
	}
	const scope = isIntentCacheEnabled(domia)
		? judgeCacheScope(domia, request)
		: null
	const cached = scope === null ? null : lookupJudgeCache(scope, transcript)
	if (cached) {
		intentRouterLogger.info(
			`tool judge: ${cached.tool ?? TOOL_JUDGE_NONE} (cached)`,
			{ domiaId: domia.id },
		)
		return cached
	}
	try {
		const chosen = remote
			? await remoteChoice(remote, request)
			: await runLLMChoice(
					domia,
					request,
					domia.llmModelConfig?.intentModelName?.trim() || DEFAULT_INTENT_MODEL,
				)
		const named = chosen && chosen !== TOOL_JUDGE_NONE ? chosen : null
		intentRouterLogger.info(
			`tool judge: ${named ?? TOOL_JUDGE_NONE} (${Date.now() - started}ms)`,
			{ domiaId: domia.id },
		)
		const verdict = { tool: named, failed: false }
		if (scope !== null) rememberJudgeVerdict(domia, scope, transcript, verdict)
		return verdict
	} catch (error) {
		intentRouterLogger.warn("tool judge failed — no tool named", {
			domiaId: domia.id,
			error,
		})
		return { tool: null, failed: true }
	}
}

export const retryCueHit = (
	transcript: string,
	language: string | null | undefined,
): string | null =>
	markerHit(transcript, languageSetsFor(language ?? null).retryCues)

export const numericFollowUp = (
	transcript: string,
	language: string | null | undefined,
): boolean => {
	const sets = languageSetsFor(language)
	const tokens = transcript
		.toLowerCase()
		.replace(/[.,!?¡¿%]/g, " ")
		.split(/\s+/)
		.filter(Boolean)
	if (tokens.length === 0 || tokens.length > 4) return false
	let hasNumber = false
	for (const token of tokens) {
		if (/^\d+$/.test(token) || token in sets.numberWords) {
			hasNumber = true
			continue
		}
		if (sets.numberJoiners.includes(token)) continue
		if (sets.percentWords.includes(token)) continue
		return false
	}
	return hasNumber
}
