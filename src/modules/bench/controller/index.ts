import { existsSync, readFileSync } from "fs"
import path from "path"
import {
	benchLogger,
	domiaError,
	BENCH_ERRORS,
	getWavDurationMs,
	sleep,
} from "@/utils"
import type { DomiaType } from "@/modules/core"
import { runInteraction, getActiveTurn } from "@/modules/core-bus"
import { getInteractionById } from "@/modules/session-manager"
import { configHealth } from "@/modules/config"
import { INTERACTION_STATUS_ENUM } from "@/db"
import {
	BENCH_CORPUS_PATH,
	BENCH_FIXTURES_DIR,
	BENCH_TRACE_POLL_MAX,
	BENCH_TRACE_POLL_MS,
} from "../constants"
import {
	detectHardware,
	resolveThresholds,
	collectSamples,
	computeStageVerdicts,
	overallVerdict,
} from "../utils"
import type {
	BenchCorpusEntryType,
	BenchCorpusType,
	BenchRunOptionsType,
	BenchRunResultType,
	BenchTraceRowType,
	BenchTurnRowType,
} from "../types"

const PROJECT_ROOT = path.resolve(__dirname, "../../../..")

let running = false

export const isBenchRunning = (): boolean => running

export const acquireBench = (): (() => void) | null => {
	if (running) return null
	running = true
	return () => {
		running = false
	}
}

const loadCorpus = (): BenchCorpusType => {
	const file = path.resolve(PROJECT_ROOT, BENCH_CORPUS_PATH)
	if (!existsSync(file))
		throw domiaError(BENCH_ERRORS.CORPUS_NOT_FOUND, {
			logger: benchLogger,
			meta: { file },
		})
	return JSON.parse(readFileSync(file, "utf8")) as BenchCorpusType
}

const emptyRow = (id: string): BenchTurnRowType => ({
	id,
	interactionId: null,
	status: "failed",
	transcript: "",
	sttMs: null,
	llmTtftMs: null,
	llmMs: null,
	ttsMs: null,
	toolMs: null,
	totalMs: null,
})

const readTrace = async (
	interactionId: string,
): Promise<BenchTraceRowType | null> => {
	let row: BenchTraceRowType | undefined
	for (let i = 0; i < BENCH_TRACE_POLL_MAX; i++) {
		row = await getInteractionById(interactionId)
		if (row?.totalMs != null) return row
		await sleep(BENCH_TRACE_POLL_MS)
	}
	return row ?? null
}

const rowFromTrace = (
	id: string,
	interactionId: string,
	trace: BenchTraceRowType | null,
): BenchTurnRowType => ({
	id,
	interactionId,
	status: trace?.status === INTERACTION_STATUS_ENUM.OK ? "ok" : "failed",
	transcript: trace?.sttResult ?? "",
	sttMs: trace?.sttMs ?? null,
	llmTtftMs: trace?.llmTtftMs ?? null,
	llmMs: trace?.llmMs ?? null,
	ttsMs: trace?.ttsMs ?? null,
	toolMs: trace?.agentToolMs ?? null,
	totalMs: trace?.totalMs ?? null,
	...(trace ? {} : { error: "interaction trace not found" }),
	...(trace && trace.status !== INTERACTION_STATUS_ENUM.OK
		? { error: `interaction status: ${trace.status}` }
		: {}),
})

const runTurn = async (
	domia: DomiaType,
	entry: BenchCorpusEntryType,
): Promise<BenchTurnRowType> => {
	const filePath = path.resolve(
		PROJECT_ROOT,
		BENCH_FIXTURES_DIR,
		`${entry.id}.wav`,
	)
	if (!existsSync(filePath))
		return { ...emptyRow(entry.id), error: `fixture missing: ${filePath}` }
	try {
		const result = await runInteraction(domia, {
			input: {
				kind: "audio_file",
				filePath,
				inputAudioMs: (await getWavDurationMs(filePath)) ?? undefined,
			},
			requestedOutput: { kind: "voice" },
			source: "http",
			audioDelivery: "audio-url",
			liveTurn: true,
			prefetch: true,
			reflect: false,
		})
		return rowFromTrace(
			entry.id,
			result.interactionId,
			await readTrace(result.interactionId),
		)
	} catch (err) {
		return {
			...emptyRow(entry.id),
			error: err instanceof Error ? err.message : String(err),
		}
	}
}

export const runBench = async (
	domia: DomiaType,
	options: BenchRunOptionsType = {},
): Promise<BenchRunResultType> => {
	const startedAt = Date.now()
	const corpus = loadCorpus()
	const requested = Math.min(
		Math.max(1, options.turns ?? domia.benchTurns),
		corpus.golden.length,
	)
	const hardware = detectHardware()
	const thresholds = resolveThresholds(
		domia.benchThresholds,
		hardware.hardwareClass,
	)
	benchLogger.info(`🧪 bench start · ${requested} turns`, {
		domiaKey: domia.domiaKey,
		hardwareClass: hardware.hardwareClass,
		hardwareLabel: hardware.hardwareLabel,
	})
	const rows: BenchTurnRowType[] = []
	for (const entry of corpus.golden.slice(0, requested)) {
		if (getActiveTurn(domia.id)) {
			rows.push({
				...emptyRow(entry.id),
				status: "skipped",
				error: "live turn in progress",
			})
			continue
		}
		const row = await runTurn(domia, entry)
		rows.push(row)
		benchLogger.info(
			`🧪 ${entry.id} ${row.status} · stt:${row.sttMs} ttft:${row.llmTtftMs} llm:${row.llmMs} tts:${row.ttsMs} total:${row.totalMs}`,
			{
				domiaKey: domia.domiaKey,
				interactionId: row.interactionId,
				error: row.error,
			},
		)
	}
	const stages = computeStageVerdicts(collectSamples(rows), thresholds, {
		sttEngine: domia.sttConfig?.engine ?? null,
		ttsEngine: domia.ttsConfig?.engine ?? null,
	})
	const completed = rows.filter((r) => r.status === "ok").length
	const skipped = rows.filter((r) => r.status === "skipped").length
	const failed = rows.length - completed - skipped
	const verdict = overallVerdict(stages, failed)
	const health = configHealth(domia)
	const durationMs = Date.now() - startedAt
	benchLogger.info(`🧪 bench done · ${verdict} · ${durationMs}ms`, {
		domiaKey: domia.domiaKey,
		completed,
		failed,
		skipped,
		healthOk: health.ok,
	})
	return {
		ok: health.ok && verdict !== "failed",
		verdict,
		hardware,
		turns: { requested, completed, failed, skipped },
		durationMs,
		startedAt: new Date(startedAt).toISOString(),
		stages,
		rows,
		health,
	}
}
