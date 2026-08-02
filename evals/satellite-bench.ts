import WebSocket from "ws"
import { writeFileSync, mkdirSync, readFileSync } from "fs"
import path from "path"
import {
	env,
	parseWavPcm,
	sleep,
	queryOne,
	configSnapshot,
	runtimeSnapshot,
	ladderDeltas,
	ladderViolations,
	wasSpeculationCommitted,
	endpointAckStats,
	uniqueArtifactPath,
	LADDER_STAGE_COLS,
} from "./lib"

const LABEL = process.argv[2] ?? "sat-bench"
const SPEED = Number(process.env.SATBENCH_SPEED ?? "1")
const RUNS = Number(process.env.SATBENCH_RUNS ?? "2")
const LIVE = process.env.SATBENCH_LIVE !== "0"
const FRAME_MS = 200
const LEADING_SILENCE_MS = Number(process.env.SATBENCH_LEAD_MS ?? "500")
const TRAILING_SILENCE_MS = 900
const OUT_DIR = path.resolve("evals/bench-results")
const FIXTURES = "evals/fixtures/stt"

type CorpusType = { cases: { id: string; text: string }[] }
type TraceMetricsType = {
	perceived_ttfa_ms: number | null
	ttfa_ms: number | null
	tts_first_chunk_ms: number | null
	stt_ms: number | null
	total_ms: number | null
	stt_result: string | null
	status: string | null
}

const MAX = Number(process.env.SATBENCH_MAX ?? "0")
const CUSTOM_WAV = process.env.SATBENCH_WAV ?? ""
const corpus = CUSTOM_WAV
	? ({
			cases: [{ id: path.basename(CUSTOM_WAV, ".wav"), text: "" }],
		} as CorpusType)
	: (JSON.parse(
			readFileSync(path.join(FIXTURES, "corpus.json"), "utf-8"),
		) as CorpusType)
if (!CUSTOM_WAV && MAX > 0) corpus.cases = corpus.cases.slice(0, MAX)

const wsUrl = (): string =>
	`${env.EVAL_URL.replace(/^http/, "ws")}/satellite${LIVE ? "?live=1" : ""}`

const drive = (satelliteId: string, wavPath: string): Promise<string | null> =>
	new Promise((resolve) => {
		const { pcm, sampleRate, channels } = parseWavPcm(wavPath)
		const frameBytes = Math.round((sampleRate * channels * 2 * FRAME_MS) / 1000)
		const ws = new WebSocket(wsUrl())
		let done = false
		const finish = (id: string | null): void => {
			if (done) return
			done = true
			try {
				ws.close()
			} catch {
				return
			}
			resolve(id)
		}
		const timeout = setTimeout(() => finish(null), 60_000)
		ws.on("open", () =>
			ws.send(
				JSON.stringify({
					type: "hello",
					satelliteId,
					domiaKey: env.EVAL_DOMIA_KEY,
					sampleRate,
					channels,
					token: env.DOMIA_MESH_SECRET,
				}),
			),
		)
		const stream = async (): Promise<void> => {
			const silence = Buffer.alloc(frameBytes)
			for (let ms = 0; ms < LEADING_SILENCE_MS; ms += FRAME_MS) {
				if (done) return
				ws.send(silence)
				await sleep(FRAME_MS / SPEED)
			}
			for (let i = 0; i < pcm.length; i += frameBytes) {
				if (done) return
				ws.send(pcm.subarray(i, Math.min(i + frameBytes, pcm.length)))
				await sleep(FRAME_MS / SPEED)
			}
			if (LIVE) {
				for (let ms = 0; ms < TRAILING_SILENCE_MS; ms += FRAME_MS) {
					if (done) return
					ws.send(silence)
					await sleep(FRAME_MS / SPEED)
				}
			} else {
				ws.send(JSON.stringify({ type: "speech_end" }))
			}
		}
		let playedSent = false
		let audioInteractionId: string | undefined
		ws.on("message", (data, isBinary) => {
			if (isBinary) {
				if (!playedSent) {
					playedSent = true
					ws.send(
						JSON.stringify({
							type: "audio_played",
							...(audioInteractionId
								? { interactionId: audioInteractionId }
								: {}),
						}),
					)
				}
				return
			}
			const msg = JSON.parse(data.toString()) as {
				type: string
				interactionId?: string
			}
			if (msg.type === "audio_stream_begin")
				audioInteractionId = msg.interactionId
			if (msg.type === "ready") void stream()
			else if (msg.type === "reply_done") {
				clearTimeout(timeout)
				finish(msg.interactionId ?? null)
			} else if (msg.type === "error") {
				clearTimeout(timeout)
				finish(null)
			}
		})
		ws.on("error", () => {
			clearTimeout(timeout)
			finish(null)
		})
	})

const traceRow = (id: string): TraceMetricsType | undefined =>
	queryOne<TraceMetricsType>(
		`SELECT perceived_ttfa_ms, ttfa_ms, tts_first_chunk_ms, stt_ms, total_ms, llm_ttft_ms, llm_fresh_tokens, llm_cached_tokens, stt_result, status, ${LADDER_STAGE_COLS.join(", ")} FROM interaction_trace WHERE id = ?`,
		[id],
	)

const pct = (xs: number[], p: number): number => {
	if (xs.length === 0) return 0
	const sorted = [...xs].sort((a, b) => a - b)
	return sorted[
		Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
	]
}

const stat = (xs: number[]): Record<string, number> => ({
	p50: pct(xs, 50),
	p95: pct(xs, 95),
	min: xs.length ? Math.min(...xs) : 0,
	max: xs.length ? Math.max(...xs) : 0,
})

const main = async (): Promise<void> => {
	console.log(
		`=== bench:satellite · label="${LABEL}" · ${wsUrl()} · runs=${RUNS} · speed=${SPEED}x ===`,
	)
	const rows: Record<string, unknown>[] = []
	let driveFailures = 0
	for (let run = 1; run <= RUNS; run++) {
		for (const c of corpus.cases) {
			const id = await drive(
				"sat-bench",
				CUSTOM_WAV || path.join(FIXTURES, `${c.id}.wav`),
			)
			if (!id) {
				console.log(`  ${c.id}#${run}  FAILED (no interactionId)`)
				driveFailures += 1
				rows.push({
					id: `${c.id}#${run}`,
					cold: run === 1,
					status: "drive_failed",
				})
				continue
			}
			let row: TraceMetricsType | undefined
			for (let i = 0; i < 20 && !row?.total_ms; i++) {
				await sleep(300)
				row = traceRow(id)
			}
			if (!row) continue
			const speculative = wasSpeculationCommitted(id)
			const issues = speculative
				? []
				: ladderViolations(row as unknown as Record<string, unknown>)
			const ack = endpointAckStats(id)
			if (LIVE && ack.ackCount !== 1)
				issues.push(`endpoint.accepted count=${ack.ackCount} (expected 1)`)
			if (LIVE && ack.beforeSttFinal === false)
				issues.push("endpoint.accepted ordered after stt.final")
			if (issues.length)
				console.warn(
					`  ⚠️ ladder violations ${c.id}#${run}: ${issues.join("; ")}`,
				)
			rows.push({
				...row,
				...ladderDeltas(row as unknown as Record<string, unknown>),
				speculative,
				endpointAckCount: ack.ackCount,
				endpointAckBeforeSttFinal: ack.beforeSttFinal,
				ladderIssues: issues,
				id: `${c.id}#${run}`,
				cold: run === 1,
			})
			console.log(
				`  ${c.id}#${run}  stt:${row.stt_ms}  ttfa:${row.ttfa_ms}  perceived:${row.perceived_ttfa_ms}  total:${row.total_ms}  "${(row.stt_result ?? "").slice(0, 40)}"`,
			)
		}
	}
	const warm = rows.filter((r) => r.cold !== true && r.status === "ok")
	const cols = [
		"stt_ms",
		"tts_first_chunk_ms",
		"ttfa_ms",
		"perceived_ttfa_ms",
		"total_ms",
		"llm_ttft_ms",
		"llm_fresh_tokens",
		"llm_cached_tokens",
		"d_endpoint_ms",
		"d_stt_final_ms",
		"d_prompt_ready_ms",
		"d_llm_queued_ms",
		"d_first_token_ms",
		"d_tts_first_unit_ms",
		"d_audio_delivered_ms",
		"d_audible_ms",
		"d_speech_to_delivered_ms",
	] as const
	const summary: Record<string, Record<string, number>> = {}
	for (const col of cols) {
		const xs = warm
			.map((r) => r[col])
			.filter((v): v is number => typeof v === "number")
		if (xs.length) summary[col] = stat(xs)
	}
	const violationCount = rows.reduce(
		(acc, r) => acc + ((r.ladderIssues as string[] | undefined)?.length ?? 0),
		0,
	)
	if (violationCount > 0)
		console.error(`❌ ladder monotonicity violations: ${violationCount}`)
	console.log(`\n=== warm p50/p95 (n=${warm.length}) ===`)
	for (const [k, v] of Object.entries(summary))
		console.log(
			`  ${k.padEnd(24)} p50=${String(v.p50).padStart(5)}  p95=${String(v.p95).padStart(5)}`,
		)
	mkdirSync(OUT_DIR, { recursive: true })
	const outFile = uniqueArtifactPath(OUT_DIR, LABEL)
	writeFileSync(
		outFile,
		JSON.stringify(
			{
				label: LABEL,
				live: LIVE,
				speed: SPEED,
				runs: RUNS,
				n: warm.length,
				failed: driveFailures,
				ladderViolations: violationCount,
				snapshot: configSnapshot(),
				runtime: runtimeSnapshot(),
				summary,
				rows,
			},
			null,
			"\t",
		),
	)
	console.log(`results → ${outFile}`)
	process.exit(violationCount > 0 ? 1 : 0)
}

void main()
