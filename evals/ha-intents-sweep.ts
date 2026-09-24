import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { DomiaType } from "@/modules/core"
import type { SelectSkillProviderType } from "@/db"
import { FAST_PATH_SKIP_PHRASES_PER_SIDE } from "@/db"
import { connectProvider, disconnectProviders } from "@/modules/skill-engine"
import { homeAssistantSpecialization } from "@/modules/skill-engine/specializations"
import { HA_FAST_PATH_EXCLUDED_DOMAINS } from "@/modules/skill-engine/specializations/home-assistant/constants"
import { toolBaseName } from "@/modules/skill-engine/utils/tool-name"
import { matchFastPath, invalidateFastPathIndex } from "@/modules/fast-path"
import { parseTemplate, lintTemplate } from "@/modules/fast-path/utils/grammar"
import { fold, stripSkipWords } from "@/modules/fast-path/utils/normalize"
import { languageSetsFor } from "@/utils"
import { baseLlmModelConfig } from "@/test-utils/mocks/llm-model-config"

import {
	HA_MCP_TOOLS,
	HA_READ_TOOL,
	HA_TARGETED_TOOLS,
	compareSlots,
	haProviderRow,
	hasTargetSlot,
	loadHaIntentsBaseline,
	loadHaIntentsRows,
	loadHaIntentsSite,
	loadHaIntentsTemplates,
	makeChecker,
	percentile,
	siteToMockEntities,
	sleep,
	startMockHa,
} from "./lib"
import type {
	HaIntentScopeType,
	HaIntentsBaselineEntryType,
	HaIntentsBaselineType,
	HaIntentsMetaType,
	HaIntentsRowType,
	HaIntentsRowsFileType,
	HaIntentsSiteFileType,
	HaIntentsTemplatesFileType,
	HaSweepActionCountsType,
	HaSweepIntentReportType,
	HaSweepLanguageReportType,
	HaSweepMissCountsType,
	HaSweepRowVerdictType,
	HaSweepSampleBucketType,
	HaSweepTemplateCompatType,
} from "./types"

const checker = makeChecker()
const BENCH_DIR = join(process.cwd(), "evals", "bench-results")
const LANGUAGES = ["en", "es"]
const WARMUP_POLLS = 40
const WARMUP_INTERVAL_MS = 250
const MAX_SAMPLES = 10
const COMBINATION_TABLE_INTENTS = ["HassTurnOn", "HassTurnOff", "HassLightSet"]
const SAMPLE_BUCKETS: HaSweepSampleBucketType[] = [
	"matchedWrongTool",
	"matchedWrongSlots",
	"compound",
	"houseWide",
	"falsePositive",
]

const domiaFor = (domiaId: string, language: string): DomiaType =>
	({
		id: domiaId,
		domiaKey: "HA-INTENTS",
		characterProfile: { language },
		llmModelConfig: {
			...baseLlmModelConfig(domiaId),
			fastPathEnabled: true,
			fastPathMinCoverage: 0.1,
		},
	}) as unknown as DomiaType

const slotValueCount = (
	cfg: SelectSkillProviderType,
	key: string,
	language: string,
): number =>
	homeAssistantSpecialization.fastPathSlotValues?.(cfg, key, language)
		?.length ?? 0

const warmSlotValues = async (
	cfg: SelectSkillProviderType,
	language: string,
): Promise<boolean> => {
	for (let i = 0; i < WARMUP_POLLS; i++) {
		if (slotValueCount(cfg, "entity", language) > 0) return true
		await sleep(WARMUP_INTERVAL_MS)
	}
	return false
}

const toolsWithTemplatesOf = (
	cfg: SelectSkillProviderType,
	language: string,
): Set<string> =>
	new Set(
		(
			homeAssistantSpecialization.descriptorDefaults?.(
				cfg.toolsCache ?? [],
				language,
			).fastPath?.intents ?? []
		).map((i) => toolBaseName(i.tool)),
	)

const blockerOf = (language: string, text: string): string => {
	const sets = languageSetsFor(language)
	const folded = stripSkipWords(
		fold(text),
		sets.skipWords,
		FAST_PATH_SKIP_PHRASES_PER_SIDE,
	)
	const tokens = new Set(folded.split(" "))
	return (
		sets.fastPathBlockers.find((b) =>
			b.includes(" ") ? folded.includes(b) : tokens.has(b),
		) ?? "?"
	)
}

const describeArgs = (args: Record<string, unknown>): string =>
	JSON.stringify(args)

const classifyRow = (
	domia: DomiaType,
	row: HaIntentsRowType,
	toolsWithTemplates: Set<string>,
	timings: number[],
): HaSweepRowVerdictType => {
	const v = matchFastPath(domia, row.text)
	timings.push(v.fastPathMs)
	if (row.scope !== "action") {
		if (v.kind === "miss") {
			if (v.reason === "disabled" || v.reason === "no_index")
				return { bucket: "fatal", reason: v.reason }
			return { bucket: "expectedMiss" }
		}
		const tools =
			v.kind === "match"
				? [toolBaseName(v.match.tool)]
				: v.matches.map((m) => toolBaseName(m.tool))
		const got = `${tools.join("+")} ${describeArgs(v.kind === "match" ? v.match.resolvedArgs : {})}`
		return {
			bucket: "falsePositive",
			got,
			read:
				row.scope === "read"
					? tools.every((t) => t === HA_READ_TOOL)
						? "matchedRead"
						: "matchedWrite"
					: null,
		}
	}
	const expectedTool = row.expect.tool ?? ""
	if (v.kind === "compound")
		return {
			bucket: "compound",
			got: v.matches
				.map((m) => `${toolBaseName(m.tool)} ${describeArgs(m.resolvedArgs)}`)
				.join(" + "),
		}
	if (v.kind === "match") {
		const got = toolBaseName(v.match.tool)
		const gotText = `${got} ${describeArgs(v.match.resolvedArgs)}`
		if (got !== expectedTool)
			return { bucket: "matchedWrongTool", got: gotText }
		if (HA_TARGETED_TOOLS.has(got) && !hasTargetSlot(v.match.resolvedArgs))
			return { bucket: "houseWide", got: gotText }
		const cmp = compareSlots(row.expect.args, v.match.resolvedArgs)
		if (!cmp.ok)
			return {
				bucket: "matchedWrongSlots",
				got: `${gotText} missing=${cmp.missing.join(",")} mismatched=${cmp.mismatched.join(",")}`,
			}
		return { bucket: "matchedCorrect", extraArgs: cmp.extra.length > 0 }
	}
	switch (v.reason) {
		case "disabled":
		case "no_index":
			return { bucket: "fatal", reason: v.reason }
		case "too_long":
			return { bucket: "miss", reason: "tooLong" }
		case "blocked_token":
			return {
				bucket: "miss",
				reason: "blockedToken",
				blocker: blockerOf(row.language, row.text),
			}
		case "ambiguous":
			return { bucket: "miss", reason: "ambiguous" }
		default:
			return {
				bucket: "miss",
				reason: toolsWithTemplates.has(expectedTool)
					? "noMatch"
					: "noTemplates",
			}
	}
}

const emptyMiss = (): HaSweepMissCountsType => ({
	noTemplates: 0,
	noMatch: 0,
	tooLong: 0,
	blockedToken: 0,
	ambiguous: 0,
})

const emptyCounts = (): HaSweepActionCountsType => ({
	total: 0,
	matchedCorrect: 0,
	extraArgs: 0,
	matchedWrongTool: 0,
	matchedWrongSlots: 0,
	compound: 0,
	houseWide: 0,
	miss: emptyMiss(),
})

const emptyIntentReport = (
	scope: HaIntentScopeType,
): HaSweepIntentReportType => ({
	...emptyCounts(),
	scope,
	falsePositives: 0,
	byCombination: {},
})

const applyVerdict = (
	counts: HaSweepActionCountsType,
	verdict: HaSweepRowVerdictType,
): void => {
	counts.total++
	switch (verdict.bucket) {
		case "matchedCorrect":
			counts.matchedCorrect++
			if (verdict.extraArgs) counts.extraArgs++
			return
		case "matchedWrongTool":
		case "matchedWrongSlots":
		case "compound":
		case "houseWide":
			counts[verdict.bucket]++
			return
		case "miss":
			counts.miss[verdict.reason]++
			return
		default:
			return
	}
}

const emptyTemplateCompat = (): HaSweepTemplateCompatType => ({
	blocks: 0,
	speechToPhraseBlocks: 0,
	templates: 0,
	compatible: 0,
	rejected: {
		wildcard: 0,
		permutation: 0,
		noLiteral: 0,
		slotInOptional: 0,
		unknownRule: 0,
		bareAlternation: 0,
		other: 0,
	},
})

const rejectionClassOf = (
	message: string,
): keyof HaSweepTemplateCompatType["rejected"] => {
	if (message.includes("wildcard")) return "wildcard"
	if (message.includes("permutation")) return "permutation"
	if (message.includes("required literal")) return "noLiteral"
	if (message.includes("inside optionals")) return "slotInOptional"
	if (message.includes("unknown expansion rule")) return "unknownRule"
	if (message.includes('unexpected "|"')) return "bareAlternation"
	return "other"
}

const rewriteListSlots = (template: string): string =>
	template.replace(/\{[a-z_]+:@?([a-z_]+)\}/g, "{$1}")

const templateCompatibility = (
	templates: HaIntentsTemplatesFileType,
): HaSweepTemplateCompatType => {
	const out = emptyTemplateCompat()
	for (const block of templates.blocks) {
		out.blocks++
		if (block.speechToPhrase) out.speechToPhraseBlocks++
		for (const raw of block.templates) {
			out.templates++
			const src = rewriteListSlots(raw)
			try {
				lintTemplate(parseTemplate(src, templates.rules), src)
				out.compatible++
			} catch (err) {
				out.rejected[
					rejectionClassOf(err instanceof Error ? err.message : String(err))
				]++
			}
		}
	}
	return out
}

const sweepLanguage = async (
	language: string,
	corpus: HaIntentsRowsFileType,
	site: HaIntentsSiteFileType,
	templates: HaIntentsTemplatesFileType,
): Promise<{ report: HaSweepLanguageReportType; fatal: string[] }> => {
	const domiaId = randomUUID()
	const mock = await startMockHa(
		0,
		{},
		{ entities: siteToMockEntities(site), tools: HA_MCP_TOOLS },
	)
	const cfg = haProviderRow(mock.url, domiaId, HA_MCP_TOOLS)
	const connected = await connectProvider(cfg, "home-assistant", language)
	checker.check(`${language}: HA provider connects`, connected)
	const warm = await warmSlotValues(cfg, language)
	checker.check(`${language}: entity slot values warm`, warm)
	invalidateFastPathIndex(domiaId)
	const slotValues = {
		entities: slotValueCount(cfg, "entity", language),
		areas: slotValueCount(cfg, "area", language),
	}
	const eligibleEntities = site.entities.filter(
		(e) => !HA_FAST_PATH_EXCLUDED_DOMAINS.has(e.domain),
	).length
	if (slotValues.entities < eligibleEntities)
		console.log(
			`  ⚠️  ${language}: entity slot values ${slotValues.entities} < eligible site entities ${eligibleEntities}`,
		)
	if (slotValues.areas < site.areas.length)
		console.log(
			`  ⚠️  ${language}: area slot values ${slotValues.areas} < site areas ${site.areas.length}`,
		)
	const domia = domiaFor(domiaId, language)
	const toolsWithTemplates = toolsWithTemplatesOf(cfg, language)
	const timings: number[] = []
	const fatal: string[] = []
	const report: HaSweepLanguageReportType = {
		language,
		sentences: { action: 0, read: 0, builtin: 0, excluded: 0 },
		actions: emptyCounts(),
		negatives: {
			read: { total: 0, miss: 0, matchedRead: 0, matchedWrite: 0 },
			builtin: { total: 0, matched: 0 },
			excluded: { total: 0, matched: 0 },
		},
		byIntent: {},
		blockers: {},
		samples: {
			matchedWrongTool: [],
			matchedWrongSlots: [],
			compound: [],
			houseWide: [],
			falsePositive: [],
		},
		fastPathMs: { p50: 0, p95: 0 },
		templates: templateCompatibility(templates),
		slotValues,
	}
	for (const row of corpus.rows) {
		report.sentences[row.scope]++
		const verdict = classifyRow(domia, row, toolsWithTemplates, timings)
		if (!Object.hasOwn(report.byIntent, row.intent))
			report.byIntent[row.intent] = emptyIntentReport(row.scope)
		const intent = report.byIntent[row.intent]
		if (!Object.hasOwn(intent.byCombination, row.combination))
			intent.byCombination[row.combination] = emptyCounts()
		const combination = intent.byCombination[row.combination]
		const expected = `${row.expect.tool ?? "—"} ${describeArgs(row.expect.args)}`
		if (verdict.bucket === "fatal") {
			fatal.push(`${row.id}: ${verdict.reason}`)
			continue
		}
		if (row.scope === "action") {
			applyVerdict(report.actions, verdict)
			applyVerdict(intent, verdict)
			applyVerdict(combination, verdict)
			if (verdict.bucket === "miss" && verdict.blocker !== undefined)
				report.blockers[verdict.blocker] =
					(report.blockers[verdict.blocker] ?? 0) + 1
			if (
				verdict.bucket === "matchedWrongTool" ||
				verdict.bucket === "matchedWrongSlots" ||
				verdict.bucket === "compound" ||
				verdict.bucket === "houseWide"
			) {
				const bucket = report.samples[verdict.bucket]
				if (bucket.length < MAX_SAMPLES)
					bucket.push({ text: row.text, expected, got: verdict.got })
			}
			continue
		}
		intent.total++
		combination.total++
		if (row.scope === "read") report.negatives.read.total++
		else report.negatives[row.scope].total++
		if (verdict.bucket === "expectedMiss") {
			if (row.scope === "read") report.negatives.read.miss++
			continue
		}
		if (verdict.bucket !== "falsePositive") continue
		intent.falsePositives++
		if (row.scope === "read") {
			if (verdict.read === "matchedRead") report.negatives.read.matchedRead++
			else report.negatives.read.matchedWrite++
		} else report.negatives[row.scope].matched++
		if (report.samples.falsePositive.length < MAX_SAMPLES)
			report.samples.falsePositive.push({
				text: row.text,
				expected,
				got: verdict.got,
			})
	}
	report.fastPathMs = {
		p50: percentile(timings, 50),
		p95: percentile(timings, 95),
	}
	await disconnectProviders([cfg.id])
	await mock.close()
	return { report, fatal }
}

const wrongOf = (counts: HaSweepActionCountsType): number =>
	counts.matchedWrongTool +
	counts.matchedWrongSlots +
	counts.compound +
	counts.houseWide

const falsePositivesOf = (report: HaSweepLanguageReportType): number =>
	report.negatives.read.matchedRead +
	report.negatives.read.matchedWrite +
	report.negatives.builtin.matched +
	report.negatives.excluded.matched

const missOf = (counts: HaSweepActionCountsType): number =>
	Object.values(counts.miss).reduce((a, b) => a + b, 0)

const baselineEntryOf = (
	report: HaSweepLanguageReportType,
): HaIntentsBaselineEntryType => ({
	matchedCorrect: report.actions.matchedCorrect,
	wrong: wrongOf(report.actions),
	falsePositives: falsePositivesOf(report),
})

const ratchet = (
	report: HaSweepLanguageReportType,
	baseline: HaIntentsBaselineType,
): void => {
	const entry = Object.hasOwn(baseline, report.language)
		? baseline[report.language]
		: null
	const current = baselineEntryOf(report)
	if (!entry) {
		console.log(
			`  ℹ️  ${report.language}: no baseline — baseline suggestion:\n${JSON.stringify({ [report.language]: current }, null, "\t")}`,
		)
		return
	}
	checker.check(
		`${report.language}: matchedCorrect ${current.matchedCorrect} ≥ baseline ${entry.matchedCorrect}`,
		current.matchedCorrect >= entry.matchedCorrect,
	)
	checker.check(
		`${report.language}: wrong ${current.wrong} ≤ baseline ${entry.wrong}`,
		current.wrong <= entry.wrong,
	)
	checker.check(
		`${report.language}: falsePositives ${current.falsePositives} ≤ baseline ${entry.falsePositives}`,
		current.falsePositives <= entry.falsePositives,
	)
}

const countsRow = (label: string, c: HaSweepActionCountsType): string =>
	`| ${label} | ${c.total} | ${c.matchedCorrect} | ${c.extraArgs} | ${c.matchedWrongTool} | ${c.matchedWrongSlots} | ${c.compound} | ${c.houseWide} | ${c.miss.noTemplates} | ${c.miss.noMatch} | ${c.miss.tooLong} | ${c.miss.blockedToken} | ${c.miss.ambiguous} |`

const COUNTS_HEADER = [
	"| | total | correct | +extra | wrong tool | wrong slots | compound | house-wide | no templates | no match | too long | blocked | ambiguous |",
	"|---|---|---|---|---|---|---|---|---|---|---|---|---|",
]

const markdownFor = (
	meta: HaIntentsMetaType,
	reports: HaSweepLanguageReportType[],
): string => {
	const lines: string[] = [
		"# HA intents corpus through the fast path",
		"",
		`Corpus: ${meta.source} @ ${meta.commit} (${meta.license})`,
		"",
		"## Summary",
		"",
		"| language | sentences | action | matched correct | wrong | miss | false positives | p50 ms | p95 ms |",
		"|---|---|---|---|---|---|---|---|---|",
		...reports.map(
			(r) =>
				`| ${r.language} | ${Object.values(r.sentences).reduce((a, b) => a + b, 0)} | ${r.actions.total} | ${r.actions.matchedCorrect} | ${wrongOf(r.actions)} | ${missOf(r.actions)} | ${falsePositivesOf(r)} | ${r.fastPathMs.p50} | ${r.fastPathMs.p95} |`,
		),
		"",
		"## Negatives",
		"",
		"| language | read total | read miss | read → GetLiveContext | read → write | builtin total | builtin matched | excluded total | excluded matched |",
		"|---|---|---|---|---|---|---|---|---|",
		...reports.map(
			(r) =>
				`| ${r.language} | ${r.negatives.read.total} | ${r.negatives.read.miss} | ${r.negatives.read.matchedRead} | ${r.negatives.read.matchedWrite} | ${r.negatives.builtin.total} | ${r.negatives.builtin.matched} | ${r.negatives.excluded.total} | ${r.negatives.excluded.matched} |`,
		),
	]
	for (const r of reports) {
		lines.push(
			"",
			`## ${r.language} — action intents`,
			"",
			...COUNTS_HEADER,
			...Object.entries(r.byIntent)
				.filter(([, v]) => v.scope === "action")
				.map(([intent, v]) => countsRow(intent, v)),
		)
		for (const intent of COMBINATION_TABLE_INTENTS) {
			if (!Object.hasOwn(r.byIntent, intent)) continue
			const v = r.byIntent[intent]
			lines.push(
				"",
				`### ${r.language} — ${intent} by combination`,
				"",
				...COUNTS_HEADER,
				...Object.entries(v.byCombination).map(([combo, c]) =>
					countsRow(combo, c),
				),
			)
		}
		lines.push("", `### ${r.language} — blockers`, "")
		const blockers = Object.entries(r.blockers).sort((a, b) => b[1] - a[1])
		lines.push(
			blockers.length
				? blockers.map(([w, n]) => `- \`${w}\`: ${n}`).join("\n")
				: "- none",
		)
		for (const bucket of SAMPLE_BUCKETS) {
			const samples = r.samples[bucket]
			if (samples.length === 0) continue
			lines.push(
				"",
				`### ${r.language} — samples: ${bucket}`,
				"",
				"| text | expected | got |",
				"|---|---|---|",
				...samples.map(
					(s) =>
						`| ${s.text} | ${s.expected.replace(/\|/g, "\\|")} | ${s.got.replace(/\|/g, "\\|")} |`,
				),
			)
		}
		const t = r.templates
		lines.push(
			"",
			`### ${r.language} — template compatibility`,
			"",
			`- blocks: ${t.blocks} (speech-to-phrase: ${t.speechToPhraseBlocks})`,
			`- templates: ${t.templates} — compatible ${t.compatible}, rejected ${t.templates - t.compatible}`,
			`- rejected by class: wildcard ${t.rejected.wildcard} · permutation ${t.rejected.permutation} · no literal ${t.rejected.noLiteral} · slot in optional ${t.rejected.slotInOptional} · unknown rule ${t.rejected.unknownRule} · bare alternation ${t.rejected.bareAlternation} · other ${t.rejected.other}`,
			`- slot values: ${r.slotValues.entities} entities · ${r.slotValues.areas} areas`,
		)
	}
	return lines.join("\n")
}

const main = async (): Promise<void> => {
	const loaded = LANGUAGES.map((language) => {
		try {
			return {
				language,
				corpus: loadHaIntentsRows(language),
				site: loadHaIntentsSite(language),
				templates: loadHaIntentsTemplates(language),
			}
		} catch (err) {
			checker.check(
				`${language}: corpus loads`,
				false,
				err instanceof Error ? err.message.slice(0, 200) : String(err),
			)
			return null
		}
	})
	const baseline = loadHaIntentsBaseline()
	const reports: HaSweepLanguageReportType[] = []
	for (const entry of loaded) {
		if (!entry) continue
		checker.check(
			`${entry.language}: corpus loads (${entry.corpus.rows.length} rows)`,
			entry.corpus.rows.length > 0,
		)
		const { report, fatal } = await sweepLanguage(
			entry.language,
			entry.corpus,
			entry.site,
			entry.templates,
		)
		checker.check(
			`${entry.language}: no disabled/no_index verdicts`,
			fatal.length === 0,
			fatal.slice(0, 3).join("; "),
		)
		ratchet(report, baseline)
		reports.push(report)
	}
	const meta = loaded.find((e) => e !== null)?.corpus.meta ?? {
		source: "",
		commit: "",
		license: "",
		generatedBy: "",
	}
	mkdirSync(BENCH_DIR, { recursive: true })
	writeFileSync(
		join(BENCH_DIR, "ha-intents-sweep.json"),
		JSON.stringify({ corpus: meta, languages: reports }, null, "\t"),
	)
	const md = markdownFor(meta, reports)
	writeFileSync(join(BENCH_DIR, "ha-intents-sweep.md"), md)
	console.log(`\n${md}`)
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} ha-intents sweep checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
