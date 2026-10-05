import { randomUUID } from "crypto"
import { readFileSync } from "fs"
import { join } from "path"

import { LLM_ENGINE_ENUM, type SkillToolType } from "@/db"
import type { DomiaType } from "@/modules/core"
import type { JudgeCatalogType } from "@/modules/core-bus/types"
import { requestedToolOf, routingBlockerHit } from "@/modules/intent-router"
import { toolBaseName } from "@/modules/skill-engine"
import { baseLlmModelConfig } from "@/test-utils/mocks/llm-model-config"

import {
	env,
	makeChecker,
	judgeCatalogFor,
	judgeToolExamplesFor,
	JUDGE_BUILTIN_TOOLS,
	JUDGE_FULL_TOOLS,
} from "./lib"
import type {
	ToolJudgeCorpusType,
	ToolJudgeGateType,
	ToolJudgeOutcomeType,
	ToolJudgeSentenceType,
} from "./types"

const checker = makeChecker()
const advisory = makeChecker()

const ADVISORY_LANGUAGES = new Set(["es"])

const checkerFor = (language: string): ReturnType<typeof makeChecker> =>
	ADVISORY_LANGUAGES.has(language) ? advisory : checker

const GATES: Record<string, ToolJudgeGateType> = {
	en: { minHitRate: 0.85, maxWrongToolRate: 0.05, maxFalseAlarmRate: 0.08 },
	es: { minHitRate: 0.7, maxWrongToolRate: 0.1, maxFalseAlarmRate: 0.08 },
}

const FULL_CATALOG_GATES: Record<string, ToolJudgeGateType> = {
	en: { minHitRate: 0.85, maxWrongToolRate: 0.1, maxFalseAlarmRate: 0.08 },
	es: { minHitRate: 0.7, maxWrongToolRate: 0.16, maxFalseAlarmRate: 0.12 },
}

const MIN_READ_RATE_ON_STATE_QUESTIONS = 0.95
const STATE_QUESTION_TOOL = "GetLiveContext"
const ALTERNATIVE_SEPARATOR = "|"
const READ_NAME_RE =
	/^(get|time|date|timer_status|.*now_playing|.*list_players|.*search_)/i

const corpus = JSON.parse(
	readFileSync(
		join(process.cwd(), "evals", "fixtures", "builtin-routing-corpus.json"),
		"utf8",
	),
) as ToolJudgeCorpusType

const domiaFor = (language: string): DomiaType =>
	({
		id: randomUUID(),
		domiaKey: "TOOL_JUDGE_EVAL",
		characterProfile: { name: "Domia", language },
		llmModelConfig: {
			...baseLlmModelConfig(),
			engine: LLM_ENGINE_ENUM.OPENAI_COMPATIBLE,
			baseUrl: env.EVAL_JUDGE_OPENAI_HOST,
		},
	}) as unknown as DomiaType

const pct = (value: number): string => `${(value * 100).toFixed(0)}%`

const fold = (text: string): string =>
	text
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim()

const providerSentences = (
	language: string,
	providers: string[],
): ToolJudgeSentenceType[] =>
	providers.flatMap((provider) =>
		Object.entries(corpus.providers[provider][language]).flatMap(
			([tool, texts]) => texts.map((text) => ({ provider, tool, text })),
		),
	)

const builtinSentences = (language: string): ToolJudgeSentenceType[] =>
	Object.entries(corpus.positives[language] ?? {}).flatMap(([tool, texts]) =>
		texts.map((text) => ({ provider: "domia", tool, text })),
	)

const nameFor = (
	catalog: JudgeCatalogType,
	tool: SkillToolType,
): string | null => {
	for (const [name, t] of catalog.byName)
		if (t.namespacedName === tool.namespacedName) return name
	return null
}

const judgeAll = async (
	domia: DomiaType,
	catalog: JudgeCatalogType,
	sentences: ToolJudgeSentenceType[],
	tools: SkillToolType[],
): Promise<ToolJudgeOutcomeType[]> => {
	const out: ToolJudgeOutcomeType[] = []
	for (const s of sentences) {
		const started = Date.now()
		const verdict = await requestedToolOf(domia, s.text, catalog.hints)
		const named =
			verdict.tool === null ? null : (catalog.byName.get(verdict.tool) ?? null)
		const accepted = s.tool.split(ALTERNATIVE_SEPARATOR)
		const wanted = tools.filter(
			(t) =>
				t.provider === s.provider && accepted.includes(toolBaseName(t.rawName)),
		)
		const base = named ? toolBaseName(named.rawName) : null
		const exact =
			named !== null &&
			wanted.some((t) => t.namespacedName === named.namespacedName)
		const rescuedByQuestionRule =
			!exact &&
			named !== null &&
			s.text.trim().endsWith("?") &&
			named.provider === s.provider &&
			wanted.some((t) => READ_NAME_RE.test(toolBaseName(t.rawName))) &&
			!READ_NAME_RE.test(base ?? "")
		out.push({
			...s,
			named: base,
			hit: exact || rescuedByQuestionRule,
			rescued: rescuedByQuestionRule,
			failed: verdict.failed,
			ms: Date.now() - started,
		})
	}
	return out
}

const judgeOthers = async (
	domia: DomiaType,
	catalog: JudgeCatalogType,
	texts: string[],
	language: string,
): Promise<ToolJudgeOutcomeType[]> => {
	const out: ToolJudgeOutcomeType[] = []
	for (const text of texts) {
		const started = Date.now()
		const verdict = await requestedToolOf(domia, text, catalog.hints)
		const named =
			verdict.tool === null ? null : (catalog.byName.get(verdict.tool) ?? null)
		const base = named ? toolBaseName(named.rawName) : null
		const guardedByNegation =
			named !== null &&
			!READ_NAME_RE.test(base ?? "") &&
			routingBlockerHit(text, language) !== null
		out.push({
			provider: "",
			tool: "none",
			text,
			named: base,
			hit: named === null || guardedByNegation,
			rescued: guardedByNegation,
			failed: verdict.failed,
			ms: Date.now() - started,
		})
	}
	return out
}

const p = (values: number[], q: number): number => {
	const sorted = [...values].sort((a, b) => a - b)
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0
}

const report = (
	language: string,
	title: string,
	gate: ToolJudgeGateType,
	commands: ToolJudgeOutcomeType[],
	others: ToolJudgeOutcomeType[],
): void => {
	const checker = checkerFor(language)
	const missed = commands.filter((c) => !c.hit && c.named === null)
	const wrong = commands.filter((c) => !c.hit && c.named !== null)
	const alarms = others.filter((o) => !o.hit)
	const hitRate = commands.length
		? (commands.length - missed.length - wrong.length) / commands.length
		: 1
	const wrongRate = commands.length ? wrong.length / commands.length : 0
	const alarmRate = others.length ? alarms.length / others.length : 0
	const latencies = [...commands, ...others].map((o) => o.ms)
	checker.check(
		`${title}: requests are named: ${pct(hitRate)} of ${commands.length} (>= ${pct(gate.minHitRate)})`,
		hitRate >= gate.minHitRate,
		missed.map((m) => `${m.text} (want ${m.tool})`).join(" | "),
	)
	checker.check(
		`${title}: the wrong tool is rare: ${wrong.length} of ${commands.length} (<= ${pct(gate.maxWrongToolRate)})`,
		wrongRate <= gate.maxWrongToolRate,
		wrong.map((w) => `${w.text} → ${w.named} (want ${w.tool})`).join(" | "),
	)
	checker.check(
		`${title}: conversation is left alone: ${alarms.length} false alarms in ${others.length} (<= ${pct(gate.maxFalseAlarmRate)})`,
		alarmRate <= gate.maxFalseAlarmRate,
		alarms.map((a) => `${a.text} → ${a.named}`).join(" | "),
	)
	console.log(
		`  latency p50 ${p(latencies, 0.5)} ms · p90 ${p(latencies, 0.9)} ms · judge failures ${[...commands, ...others].filter((o) => o.failed).length} · questions rescued by the read rule ${commands.filter((c) => c.rescued).length} · chat guarded by the negation rule ${others.filter((o) => o.rescued).length}`,
	)
	for (const m of missed) console.log(`  · missed: ${m.text} (want ${m.tool})`)
	for (const w of wrong)
		console.log(`  · wrong: ${w.text} → ${w.named} (want ${w.tool})`)
	for (const a of alarms) console.log(`  · false alarm: ${a.text} → ${a.named}`)
}

const perProvider = (commands: ToolJudgeOutcomeType[]): void => {
	const providers = [...new Set(commands.map((c) => c.provider))]
	for (const provider of providers) {
		const mine = commands.filter((c) => c.provider === provider)
		const hits = mine.filter((c) => c.hit).length
		const wrong = mine.filter((c) => !c.hit && c.named !== null).length
		console.log(
			`  ${provider}: ${hits}/${mine.length} named · ${wrong} wrong tool`,
		)
	}
}

const checkNoOverlap = (language: string): void => {
	const taught = new Set(
		Object.values(judgeToolExamplesFor(language)).flat().map(fold),
	)
	const tested = [
		...builtinSentences(language),
		...providerSentences(language, Object.keys(corpus.providers)),
		...(corpus.compounds[language] ?? []).map((c) => ({ text: c.text })),
	]
	const overlap = tested.filter((s) => taught.has(fold(s.text)))
	checker.check(
		`${language}: no evaluation sentence is a descriptor example (${tested.length} checked)`,
		overlap.length === 0,
		overlap.map((o) => o.text).join(" | "),
	)
}

const checkBuiltinsOnly = async (language: string): Promise<void> => {
	console.log(
		`\n${language} · builtins only: the judge names the builtin a request asks for`,
	)
	const domia = domiaFor(language)
	const catalog = judgeCatalogFor(language, JUDGE_BUILTIN_TOOLS)
	const commands = await judgeAll(
		domia,
		catalog,
		builtinSentences(language),
		JUDGE_BUILTIN_TOOLS,
	)
	const others = await judgeOthers(
		domia,
		catalog,
		[
			...(corpus.chat[language] ?? []),
			...providerSentences(language, Object.keys(corpus.providers)).map(
				(s) => s.text,
			),
			...(corpus.unconnected[language] ?? []),
		],
		language,
	)
	report(language, `${language} builtins`, GATES[language], commands, others)
}

const checkFullCatalog = async (language: string): Promise<void> => {
	console.log(
		`\n${language} · full catalog (${JUDGE_FULL_TOOLS.length} tools): the judge names the tool of any provider`,
	)
	const domia = domiaFor(language)
	const catalog = judgeCatalogFor(language, JUDGE_FULL_TOOLS)
	const commands = await judgeAll(
		domia,
		catalog,
		[
			...builtinSentences(language),
			...providerSentences(language, Object.keys(corpus.providers)),
		],
		JUDGE_FULL_TOOLS,
	)
	const others = await judgeOthers(
		domia,
		catalog,
		[...(corpus.chat[language] ?? []), ...(corpus.unconnected[language] ?? [])],
		language,
	)
	report(
		language,
		`${language} full`,
		FULL_CATALOG_GATES[language],
		commands,
		others,
	)
	perProvider(commands)
	const stateQuestions = commands.filter((c) => c.tool === STATE_QUESTION_TOOL)
	const readNamed = stateQuestions.filter((c) => c.hit).length
	if (stateQuestions.length > 0)
		checkerFor(language).check(
			`${language} full: state questions name the read tool: ${readNamed}/${stateQuestions.length} (>= ${pct(MIN_READ_RATE_ON_STATE_QUESTIONS)})`,
			readNamed / stateQuestions.length >= MIN_READ_RATE_ON_STATE_QUESTIONS,
			stateQuestions
				.filter((c) => !c.hit)
				.map((c) => `${c.text} → ${c.named}`)
				.join(" | "),
		)
	const compounds = corpus.compounds[language] ?? []
	let compoundHits = 0
	for (const c of compounds) {
		const verdict = await requestedToolOf(domia, c.text, catalog.hints)
		const named =
			verdict.tool === null ? null : (catalog.byName.get(verdict.tool) ?? null)
		const base = named ? toolBaseName(named.rawName) : null
		if (base !== null && c.tools.includes(base)) compoundHits++
		console.log(
			`  · compound: ${c.text} → ${base ?? "none"} (any of ${c.tools.join("/")})`,
		)
	}
	if (compounds.length > 0)
		console.log(
			`  compounds: ${compoundHits}/${compounds.length} name one of their tools (reported, not gated)`,
		)
	const shown = catalog.hints.map((h) => h.name)
	checkerFor(language).check(
		`${language} full: every tool shows under a unique name (${shown.length})`,
		new Set(shown).size === shown.length &&
			JUDGE_FULL_TOOLS.every((t) => nameFor(catalog, t) !== null),
	)
}

const main = async (): Promise<void> => {
	for (const language of Object.keys(GATES)) {
		checkNoOverlap(language)
		await checkBuiltinsOnly(language)
		await checkFullCatalog(language)
	}
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(
		`\n${pass}/${pass + fail} tool-judge checks passed · advisory (${[...ADVISORY_LANGUAGES].join(", ")}, not gated until the Spanish polish session): ${advisory.passCount()}/${advisory.passCount() + advisory.failCount()}`,
	)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
