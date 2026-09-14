import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { randomUUID } from "crypto"

import {
	scoreIntentEmbedding,
	routingBlockerHit,
	stateQuestionHit,
	retryCueHit,
	personalQuestionHit,
} from "@/modules/intent-router"
import { homeAssistantSpecialization } from "@/modules/skill-engine"
import type { DomiaType } from "@/modules/core"

import {
	DEFAULT_INTENT_EMBED_THRESHOLD,
	DEFAULT_INTENT_LEXICAL_MIN_SCORE,
} from "@/db"

import { makeChecker } from "./lib"
import type { EvalCaseType } from "./types"

const checker = makeChecker()
const BENCH_DIR = join(process.cwd(), "evals", "bench-results")
const AMBIGUITY_BAND = 0.06
const ES_OPERATIVE_THRESHOLD = 0.5
const THRESHOLDS = Array.from({ length: 16 }, (_, i) =>
	Number((0.5 + i * 0.02).toFixed(2)),
)
const LEXICAL_MINS = [
	0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10,
] as const

const HA_TOOLS = [
	{ name: "HassTurnOn", description: "Turns on/opens a device or entity" },
	{ name: "HassTurnOff", description: "Turns off/closes a device or entity" },
	{
		name: "HassLightSet",
		description: "Sets the brightness or color of lights",
	},
	{
		name: "GetLiveContext",
		description:
			"Provides real-time information about the current state, value, or mode of devices, sensors, entities, or areas",
	},
]

type SweepRowType = {
	text: string
	expected: "skill" | "chat"
	advisory: boolean
	best: number
	lexical: number
	blocked: boolean
	marked: boolean
}

const loadCorpus = (file: string, language?: string): EvalCaseType[] => {
	const dir = file.includes("-es") ? "fixtures" : "cases"
	const all = JSON.parse(
		readFileSync(join("evals", dir, file), "utf8"),
	) as EvalCaseType[]
	return language ? all.filter((c) => c.language === language) : all
}

const domiaFor = (embedModelPath: string): DomiaType =>
	({
		id: randomUUID(),
		domiaKey: "ROUTING_SWEEP",
		llmModelConfig: {
			embedBackend: "transformers",
			embedModelPath,
		},
	}) as unknown as DomiaType

const verdictAt = (
	row: SweepRowType,
	threshold: number,
	lexicalMin = 0,
): "skill" | "chat" | "llm" => {
	if (row.marked) return "skill"
	if (row.best >= threshold) return row.blocked ? "llm" : "skill"
	if (row.best >= threshold - AMBIGUITY_BAND) return "llm"
	if (row.lexical > 0 && row.lexical >= lexicalMin) return "llm"
	return "chat"
}

const hintsFor = (language: string): { exampleUtterances?: string[] } => {
	const descriptor = homeAssistantSpecialization.descriptorDefaults?.(
		HA_TOOLS.map((t) => ({
			provider: "sweep",
			rawName: t.name,
			namespacedName: `sweep__${t.name}`,
			description: t.description,
			inputSchema: { type: "object", properties: {} },
		})),
		language,
	)
	return { exampleUtterances: descriptor?.routing?.exampleUtterances }
}

const sweepLanguage = async (
	label: string,
	corpusFile: string,
	embedModelPath: string,
	language: string,
	operativeThreshold: number,
	corpusLanguage?: string,
): Promise<Record<string, unknown>> => {
	const corpus = loadCorpus(corpusFile, corpusLanguage)
	const domia = domiaFor(embedModelPath)
	const hints = hintsFor(language)
	const rows: SweepRowType[] = []
	for (const c of corpus) {
		const turn = c.turns[0]
		const expected = turn.expect.routed === "chat" ? "chat" : "skill"
		const score = await scoreIntentEmbedding(domia, turn.text, HA_TOOLS, hints)
		if (!score) throw new Error(`embedding unavailable for "${turn.text}"`)
		rows.push({
			text: turn.text,
			expected,
			advisory: c.mode === "advisory",
			best: score.best,
			lexical: score.lexical,
			blocked: routingBlockerHit(turn.text, language) !== null,
			marked:
				retryCueHit(turn.text, language) !== null ||
				(personalQuestionHit(turn.text, language) === null &&
					stateQuestionHit(turn.text, language) !== null),
		})
	}
	const grid = THRESHOLDS.map((threshold) => {
		let fatalMiss = 0
		let rescued = 0
		let falseSkill = 0
		let chatToLlm = 0
		const fatalTexts: string[] = []
		for (const row of rows) {
			const v = verdictAt(row, threshold)
			if (row.expected === "skill") {
				if (v === "chat" && !row.advisory) {
					fatalMiss++
					fatalTexts.push(row.text)
				} else if (v === "llm") rescued++
			} else {
				if (v === "skill") falseSkill++
				else if (v === "llm") chatToLlm++
			}
		}
		return { threshold, fatalMiss, rescued, falseSkill, chatToLlm, fatalTexts }
	})
	const lexicalGrid = LEXICAL_MINS.map((lexicalMin) => {
		let fatalMiss = 0
		let rescued = 0
		let chatToLlm = 0
		const fatalTexts: string[] = []
		for (const row of rows) {
			const v = verdictAt(row, operativeThreshold, lexicalMin)
			if (row.expected === "skill") {
				if (v === "chat" && !row.advisory) {
					fatalMiss++
					fatalTexts.push(row.text)
				} else if (v === "llm") rescued++
			} else if (v === "llm") chatToLlm++
		}
		return { lexicalMin, fatalMiss, rescued, chatToLlm, fatalTexts }
	})
	console.log(`\n▶ ${label} (${embedModelPath.split("/").pop()})`)
	console.log(
		"| thr | fatal skill→chat | rescued→LLM | chat→skill | chat→LLM |",
	)
	for (const g of grid)
		console.log(
			`| ${g.threshold.toFixed(2)} | ${g.fatalMiss} | ${g.rescued} | ${g.falseSkill} | ${g.chatToLlm} |`,
		)
	console.log(
		`\n  lexical gate at embed threshold ${operativeThreshold.toFixed(2)}:`,
	)
	console.log("| lexMin | fatal skill→chat | rescued→LLM | chat→LLM |")
	for (const g of lexicalGrid)
		console.log(
			`| ${g.lexicalMin} | ${g.fatalMiss} | ${g.rescued} | ${g.chatToLlm} |`,
		)
	const lexicalScores = rows
		.filter((r) => r.lexical > 0)
		.map((r) => Number(r.lexical.toFixed(2)))
		.sort((a, b) => a - b)
	console.log(
		`  lexical scores seen (${lexicalScores.length} of ${rows.length}): ${lexicalScores.join(" ")}`,
	)
	return { label, embedModelPath, operativeThreshold, rows, grid, lexicalGrid }
}

const main = async (): Promise<void> => {
	const en = await sweepLanguage(
		"EN routing",
		"routing-en.json",
		"data/models/bge-small-en-v1.5",
		"en",
		DEFAULT_INTENT_EMBED_THRESHOLD,
	)
	const esMultilingual = await sweepLanguage(
		"ES routing (multilingual embed)",
		"routing-es.json",
		"data/models/paraphrase-multilingual-minilm-l12-v2",
		"es",
		ES_OPERATIVE_THRESHOLD,
	)
	const esWrongModel = await sweepLanguage(
		"ES routing (EN embed model — misconfig probe)",
		"routing-es.json",
		"data/models/bge-small-en-v1.5",
		"es",
		ES_OPERATIVE_THRESHOLD,
	)
	const negativesEn = await sweepLanguage(
		"EN chat negatives",
		"chat-negatives.json",
		"data/models/bge-small-en-v1.5",
		"en",
		DEFAULT_INTENT_EMBED_THRESHOLD,
		"en",
	)
	const negativesEs = await sweepLanguage(
		"ES chat negatives (multilingual embed)",
		"chat-negatives.json",
		"data/models/paraphrase-multilingual-minilm-l12-v2",
		"es",
		ES_OPERATIVE_THRESHOLD,
		"es",
	)
	mkdirSync(BENCH_DIR, { recursive: true })
	writeFileSync(
		join(BENCH_DIR, "routing-sweep.json"),
		JSON.stringify(
			{ en, esMultilingual, esWrongModel, negativesEn, negativesEs },
			null,
			"\t",
		),
	)
	const gridOf = (r: Record<string, unknown>) =>
		r.grid as { threshold: number; fatalMiss: number; falseSkill: number }[]
	const enAt = gridOf(en).find((g) => g.threshold === 0.66)
	checker.check(
		"EN: current default 0.66 has zero fatal misses",
		enAt?.fatalMiss === 0,
		JSON.stringify(enAt),
	)
	const esBest = gridOf(esMultilingual).filter(
		(g) => g.fatalMiss === 0 && g.falseSkill === 0,
	)
	checker.check(
		"ES(multilingual): some threshold achieves zero fatal misses and zero false skills",
		esBest.length > 0,
		`clean thresholds: ${esBest.map((g) => g.threshold).join(",") || "none"}`,
	)
	const lexicalGridOf = (r: Record<string, unknown>) =>
		r.lexicalGrid as { lexicalMin: number; fatalMiss: number }[]
	for (const [name, r] of [
		["EN", en],
		["ES(multilingual)", esMultilingual],
		["EN negatives", negativesEn],
		["ES negatives", negativesEs],
	] as const)
		checker.check(
			`${name}: intentLexicalMinScore default ${DEFAULT_INTENT_LEXICAL_MIN_SCORE} has zero fatal misses`,
			lexicalGridOf(r).find(
				(g) => g.lexicalMin === DEFAULT_INTENT_LEXICAL_MIN_SCORE,
			)?.fatalMiss === 0,
			JSON.stringify(
				lexicalGridOf(r).find(
					(g) => g.lexicalMin === DEFAULT_INTENT_LEXICAL_MIN_SCORE,
				),
			),
		)
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} routing sweep checks passed`)
	console.log("saved → evals/bench-results/routing-sweep.json")
	process.exit(fail === 0 ? 0 : 1)
}

void main()
