import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { randomUUID } from "crypto"

import {
	scoreIntentEmbedding,
	routingBlockerHit,
} from "@/modules/intent-router"
import { homeAssistantSpecialization } from "@/modules/skill-engine"
import type { SkillToolType } from "@/db"
import type { DomiaType } from "@/modules/core"

import { makeChecker } from "./lib"
import type { EvalCaseType } from "./types"

const checker = makeChecker()
const BENCH_DIR = join(process.cwd(), "evals", "bench-results")
const AMBIGUITY_BAND = 0.06
const THRESHOLDS = Array.from({ length: 16 }, (_, i) =>
	Number((0.5 + i * 0.02).toFixed(2)),
)

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
}

const loadCorpus = (file: string): EvalCaseType[] => {
	const dir = file.includes("-es") ? "fixtures" : "cases"
	return JSON.parse(readFileSync(join("evals", dir, file), "utf8"))
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
): "skill" | "chat" | "llm" => {
	if (row.best >= threshold) return row.blocked ? "llm" : "skill"
	if (row.best >= threshold - AMBIGUITY_BAND) return "llm"
	if (row.lexical > 0) return "llm"
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
		})) as SkillToolType[],
		language,
	)
	return { exampleUtterances: descriptor?.routing?.exampleUtterances }
}

const sweepLanguage = async (
	label: string,
	corpusFile: string,
	embedModelPath: string,
	language: string,
): Promise<Record<string, unknown>> => {
	const corpus = loadCorpus(corpusFile)
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
	console.log(`\n▶ ${label} (${embedModelPath.split("/").pop()})`)
	console.log(
		"| thr | fatal skill→chat | rescued→LLM | chat→skill | chat→LLM |",
	)
	for (const g of grid)
		console.log(
			`| ${g.threshold.toFixed(2)} | ${g.fatalMiss} | ${g.rescued} | ${g.falseSkill} | ${g.chatToLlm} |`,
		)
	return { label, embedModelPath, rows, grid }
}

const main = async (): Promise<void> => {
	const en = await sweepLanguage(
		"EN routing",
		"routing-en.json",
		"data/models/bge-small-en-v1.5",
		"en",
	)
	const esMultilingual = await sweepLanguage(
		"ES routing (multilingual embed)",
		"routing-es.json",
		"data/models/paraphrase-multilingual-minilm-l12-v2",
		"es",
	)
	const esWrongModel = await sweepLanguage(
		"ES routing (EN embed model — misconfig probe)",
		"routing-es.json",
		"data/models/bge-small-en-v1.5",
		"es",
	)
	mkdirSync(BENCH_DIR, { recursive: true })
	writeFileSync(
		join(BENCH_DIR, "routing-sweep.json"),
		JSON.stringify({ en, esMultilingual, esWrongModel }, null, "\t"),
	)
	const gridOf = (r: Record<string, unknown>) =>
		r.grid as { threshold: number; fatalMiss: number; falseSkill: number }[]
	const enAt = gridOf(en).find((g) => g.threshold === 0.66)
	checker.check(
		"EN: current default 0.66 has zero fatal misses",
		enAt !== undefined && enAt.fatalMiss === 0,
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
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} routing sweep checks passed`)
	console.log("saved → evals/bench-results/routing-sweep.json")
	process.exit(fail === 0 ? 0 : 1)
}

void main()
