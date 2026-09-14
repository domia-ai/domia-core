import { readFileSync } from "node:fs"
import path from "node:path"

import { LLM_ENGINE_ENUM } from "@/db"
import { openAiCompatibleEngine } from "@/modules/llm-engine/engines/openai-compatible"
import { buildPromptContext } from "@/modules/prompt-context-builder"
import { getDomia } from "@/test-utils"
import type { DomiaType } from "@/modules/core"

import { env, makeChecker, percentile, queryOne } from "./lib"
import type {
	TurnTagCorpusType,
	TurnTagExpectType,
	TurnTagObservedType,
	TurnTagSampleType,
} from "./types"

const SAMPLES = 3
const TTFT_SAMPLES = 10
const TTFT_ITEM_TEXT = "turn off the kitchen lights"

const TURN_MARK_SECTION = `Start every reply with exactly one turn mark, and never explain it.
First read the person's last words and decide whether the sentence is finished.
If it is finished, write + then a space then your reply.
If it is cut off — it stops on a word like "the", "to", "a", "and", "of", on a name or number they were still reading out, or on anything that leaves the sentence hanging — write ~ and nothing else, and wait for them to finish.
If they asked for time ("let me think", "hold on", "one moment", "espera", "déjame ver"), write # and nothing else.
Examples: "turn off the lights" → "+ Done." · "turn off the" → "~" · "the number is five five" → "~" · "let me think" → "#"
When unsure, write +.`

const MARK_TO_TAG: Record<string, TurnTagObservedType> = {
	"+": "complete",
	"~": "short",
	"#": "long",
}

const EXPECTS: TurnTagExpectType[] = ["complete", "short", "long"]
const OBSERVED: TurnTagObservedType[] = [
	"complete",
	"short",
	"long",
	"untagged",
]

const corpus = (): TurnTagCorpusType =>
	JSON.parse(
		readFileSync(path.resolve("evals/fixtures/turn-tag-corpus.json"), "utf8"),
	) as TurnTagCorpusType

const liveLlmConfig = ():
	| {
			base_url: string
			model_name: string
			tool_model_name: string | null
			temperature: number
			num_predict: number
			slot_affinity_enabled: number
			engine: string
	  }
	| undefined =>
	queryOne(
		`SELECT lmc.base_url, lmc.model_name, lmc.tool_model_name, lmc.temperature,
		        lmc.num_predict, lmc.slot_affinity_enabled, lmc.engine
		 FROM llm_model_config lmc
		 JOIN domia d ON d.id = lmc.domia_id
		 WHERE d.domia_key = ? AND lmc.is_active = 1 LIMIT 1`,
		[env.EVAL_DOMIA_KEY],
	)

const withTurnMark = (prompt: string): string => {
	const marker = "\n\n### TRANSPARENCY\n"
	const at = prompt.indexOf(marker)
	const section = `\n\n### TURN MARK\n${TURN_MARK_SECTION}`
	const tagged =
		at === -1
			? `${prompt}${section}`
			: `${prompt.slice(0, at)}${section}${prompt.slice(at)}`
	return tagged.replace(
		/, spoken aloud\):$/,
		", spoken aloud, starts with the turn mark):",
	)
}

const firstMarkOf = async (
	domia: DomiaType,
	prompt: string,
): Promise<string> => {
	for await (const token of openAiCompatibleEngine.runStream?.(domia, prompt) ??
		[]) {
		const trimmed = token.trim()
		if (trimmed.length > 0) return trimmed[0]
	}
	return ""
}

const timeToFirstToken = async (
	domia: DomiaType,
	prompt: string,
): Promise<number> => {
	const startedAt = Date.now()
	for await (const token of openAiCompatibleEngine.runStream?.(domia, prompt) ??
		[]) {
		if (token.length > 0) return Date.now() - startedAt
	}
	return Date.now() - startedAt
}

const rate = (hits: number, total: number): string =>
	total === 0
		? "n/a"
		: `${((hits / total) * 100).toFixed(1)}% (${hits}/${total})`

const main = async (): Promise<void> => {
	const config = liveLlmConfig()
	if (config?.engine !== LLM_ENGINE_ENUM.OPENAI_COMPATIBLE) {
		console.log(
			`⏭️  turn-tag-llm SKIPPED — ${env.EVAL_DOMIA_KEY} is not on the openai-compatible engine (got ${config?.engine ?? "no config"})`,
		)
		process.exit(0)
	}

	const domiaFor = (language: string): DomiaType =>
		getDomia({
			llmModelConfigOverrides: {
				engine: LLM_ENGINE_ENUM.OPENAI_COMPATIBLE,
				baseUrl: config.base_url,
				modelName: config.model_name,
				temperature: config.temperature,
				numPredict: config.num_predict,
				slotAffinityEnabled: config.slot_affinity_enabled === 1,
			},
			moduleSettingsOverrides: {
				identityEngine: true,
				emotionEngine: true,
				memoryEngine: true,
				factRecall: true,
				skillsEngine: true,
				environmentTimeEnabled: true,
			},
			characterProfileOverrides: {
				name: "Domia",
				language,
				culturalBackground: "Spain",
				languagesSpoken: ["en", "es"],
				interests: ["music", "home automation"],
				hobbies: ["reading", "cooking"],
				skills: ["conversation", "planning"],
			},
			emotionStateOverrides: {
				joy: 0.4,
				sadness: 0.05,
				anger: 0.05,
				fear: 0.05,
				trust: 0.5,
				disgust: 0.05,
				anticipation: 0.2,
				surprise: 0.05,
			},
		})

	const personas = new Map<string, DomiaType>()
	const personaFor = (language: string): DomiaType => {
		const cached = personas.get(language)
		if (cached) return cached
		const built = domiaFor(language)
		personas.set(language, built)
		return built
	}

	const { check, passCount, failCount } = makeChecker()
	console.log(
		`engine=${config.engine} baseUrl=${config.base_url} model=${config.model_name} temperature=${config.temperature} samples=${SAMPLES}\n`,
	)

	const { items } = corpus()
	const samples: TurnTagSampleType[] = []
	for (const item of items) {
		const domia = personaFor(item.language)
		const prompt = withTurnMark(buildPromptContext(domia, item.text))
		const got: TurnTagObservedType[] = []
		for (let i = 0; i < SAMPLES; i++) {
			const firstChar = await firstMarkOf(domia, prompt)
			const tag = MARK_TO_TAG[firstChar] ?? "untagged"
			got.push(tag)
			samples.push({ item, got: tag, firstChar })
		}
		console.log(
			`  ${item.expect.padEnd(8)} ${item.language} ${item.id.padEnd(30)} → ${got.join(" | ")}`,
		)
	}

	const matrix = new Map<string, number>()
	for (const s of samples) {
		const key = `${s.item.expect}|${s.got}`
		matrix.set(key, (matrix.get(key) ?? 0) + 1)
	}
	console.log("\nconfusion matrix (rows = expected, cols = observed)")
	console.log(
		`  ${"expect".padEnd(10)}${OBSERVED.map((o) => o.padStart(10)).join("")}${"total".padStart(10)}`,
	)
	for (const e of EXPECTS) {
		const row = OBSERVED.map((o) =>
			String(matrix.get(`${e}|${o}`) ?? 0).padStart(10),
		).join("")
		const total = OBSERVED.reduce(
			(acc, o) => acc + (matrix.get(`${e}|${o}`) ?? 0),
			0,
		)
		console.log(`  ${e.padEnd(10)}${row}${String(total).padStart(10)}`)
	}

	const completeSamples = samples.filter((s) => s.item.expect === "complete")
	const incompleteSamples = samples.filter((s) => s.item.expect !== "complete")
	const completeHits = completeSamples.filter(
		(s) => s.got === "complete",
	).length
	const waitHits = incompleteSamples.filter(
		(s) => s.got === "short" || s.got === "long",
	).length
	const untagged = samples.filter((s) => s.got === "untagged").length

	console.log("\nper language")
	for (const language of [...new Set(items.map((i) => i.language))]) {
		const inLang = samples.filter((s) => s.item.language === language)
		const c = inLang.filter((s) => s.item.expect === "complete")
		const inc = inLang.filter((s) => s.item.expect !== "complete")
		console.log(
			`  ${language}: complete→+ ${rate(c.filter((s) => s.got === "complete").length, c.length)} | incomplete→wait ${rate(inc.filter((s) => s.got === "short" || s.got === "long").length, inc.length)} | untagged ${rate(inLang.filter((s) => s.got === "untagged").length, inLang.length)}`,
		)
	}
	console.log("\nper class")
	for (const e of EXPECTS) {
		const inClass = samples.filter((s) => s.item.expect === e)
		const exact = inClass.filter((s) => s.got === e).length
		console.log(`  ${e}: exact mark ${rate(exact, inClass.length)}`)
	}

	console.log("")
	check(
		`complete → + ${rate(completeHits, completeSamples.length)} (need ≥ 90%)`,
		completeHits / completeSamples.length >= 0.9,
	)
	check(
		`incomplete → any wait mark ${rate(waitHits, incompleteSamples.length)} (need ≥ 70%)`,
		waitHits / incompleteSamples.length >= 0.7,
	)
	check(
		`untagged ${rate(untagged, samples.length)} (need ≤ 10%)`,
		untagged / samples.length <= 0.1,
	)

	const ttftDomia = personaFor("en")
	const plainPrompt = buildPromptContext(ttftDomia, TTFT_ITEM_TEXT)
	const taggedPrompt = withTurnMark(plainPrompt)
	const plainTtft: number[] = []
	const taggedTtft: number[] = []
	for (let i = 0; i < TTFT_SAMPLES; i++) {
		plainTtft.push(await timeToFirstToken(ttftDomia, plainPrompt))
		taggedTtft.push(await timeToFirstToken(ttftDomia, taggedPrompt))
	}
	const plainP50 = percentile(plainTtft, 50)
	const taggedP50 = percentile(taggedTtft, 50)
	console.log(
		`\nprefill cost on "${TTFT_ITEM_TEXT}" (n=${TTFT_SAMPLES} each, alternating)`,
	)
	console.log(
		`  without TURN MARK: p50 ${plainP50} ms  p95 ${percentile(plainTtft, 95)} ms  [${plainTtft.join(", ")}]`,
	)
	console.log(
		`  with    TURN MARK: p50 ${taggedP50} ms  p95 ${percentile(taggedTtft, 95)} ms  [${taggedTtft.join(", ")}]`,
	)
	console.log(`  delta p50: ${taggedP50 - plainP50} ms`)

	console.log(`\n${passCount()}/${passCount() + failCount()} checks passed`)
	process.exit(failCount() === 0 ? 0 : 1)
}

void main()
