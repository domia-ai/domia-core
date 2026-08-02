import { writeFileSync } from "fs"
import path from "path"
import WebSocket from "ws"

import {
	env,
	fabricateSegmentPcm,
	makeChecker,
	meshHeaders,
	parseWavPcm,
	queryOne,
	satelliteTurn,
	sleep,
	runtimeSnapshot,
	uniqueArtifactPath,
	endpointAckStats,
} from "./lib"

const MODE = process.env.SOAK_MODE ?? "stack"
const ROUNDS = Number(process.env.SOAK_ROUNDS ?? 4)
const OUT_DIR = path.resolve("evals/bench-results")

const checker = makeChecker()

const FLAG_SETS: Record<string, Record<string, unknown>> = {
	off: {
		wakeWord: { dynamicEndpointingEnabled: false, pauseBargeInEnabled: false },
		playback: { wordLevelHeardEnabled: false },
	},
	dyn: {
		wakeWord: { dynamicEndpointingEnabled: true, pauseBargeInEnabled: false },
		playback: { wordLevelHeardEnabled: false },
	},
	pause: {
		wakeWord: { dynamicEndpointingEnabled: false, pauseBargeInEnabled: true },
		playback: { wordLevelHeardEnabled: false },
	},
	heard: {
		wakeWord: { dynamicEndpointingEnabled: false, pauseBargeInEnabled: false },
		playback: { wordLevelHeardEnabled: true },
	},
	stack: {
		wakeWord: { dynamicEndpointingEnabled: true, pauseBargeInEnabled: true },
		playback: { wordLevelHeardEnabled: true },
	},
}

const applyFlags = async (set: Record<string, unknown>): Promise<void> => {
	const res = await fetch(`${env.EVAL_URL}/config`, {
		method: "POST",
		headers: { "content-type": "application/json", ...meshHeaders() },
		body: JSON.stringify(set),
	})
	if (!res.ok) throw new Error(`flag apply failed: ${res.status}`)
	await sleep(1500)
}

const trace = (
	id: string,
):
	| {
			status: string
			llm_response: string | null
			heard_reply: string | null
			perceived_ttfa_ms: number | null
	  }
	| undefined =>
	queryOne(
		"SELECT status, llm_response, heard_reply, perceived_ttfa_ms FROM interaction_trace WHERE id = ?",
		[id],
	)

const waitTrace = async (id: string): Promise<ReturnType<typeof trace>> => {
	for (let i = 0; i < 30; i++) {
		const row = trace(id)
		if (row?.status && row.status !== "ok") return row
		if (row?.heard_reply != null || row?.perceived_ttfa_ms != null) return row
		await sleep(500)
	}
	return trace(id)
}

const wavOf = (id: string): string =>
	path.resolve(`evals/fixtures/stt/${id}.wav`)

const liveEscalationProbe = (): Promise<{
	paused: boolean
	newTranscript: string | null
	transcripts: string[]
}> =>
	new Promise((resolve) => {
		const { pcm, sampleRate, channels } = parseWavPcm(wavOf("s10"))
		const frameMs = 200
		const frameBytes = Math.round((sampleRate * channels * 2 * frameMs) / 1000)
		const ws = new WebSocket(
			`${env.EVAL_URL.replace(/^http/, "ws")}/satellite?live=1`,
		)
		const out = {
			paused: false,
			newTranscript: null as string | null,
			transcripts: [] as string[],
		}
		let interjecting = false
		const done = (): void => {
			try {
				ws.close()
			} catch {
				/* closed */
			}
			resolve(out)
		}
		const timer = setTimeout(done, 60000)
		const paced = async (buf: Buffer): Promise<void> => {
			for (let i = 0; i < buf.length; i += frameBytes) {
				ws.send(buf.subarray(i, Math.min(i + frameBytes, buf.length)))
				await sleep(frameMs)
			}
		}
		const interject = async (): Promise<void> => {
			if (interjecting) return
			interjecting = true
			await paced(fabricateSegmentPcm("speech", 3200, sampleRate))
			await paced(Buffer.alloc(frameBytes * 6))
		}
		ws.on("open", () =>
			ws.send(
				JSON.stringify({
					type: "hello",
					satelliteId: `soak-esc-${MODE}`,
					domiaKey: env.EVAL_DOMIA_KEY,
					sampleRate,
					channels,
					token: env.DOMIA_MESH_SECRET,
				}),
			),
		)
		ws.on("message", (data, isBinary) => {
			if (isBinary) return
			const msg = JSON.parse(data.toString()) as {
				type: string
				text?: string
			}
			if (msg.type === "ready")
				void (async () => {
					await paced(Buffer.alloc(frameBytes * 3))
					await paced(pcm)
					await paced(Buffer.alloc(frameBytes * 5))
				})()
			else if (msg.type === "audio_pause") out.paused = true
			else if (msg.type === "transcript") {
				out.transcripts.push(msg.text ?? "")
				if (out.transcripts.length === 1) void interject()
				if (out.paused && out.transcripts.length > 1) {
					out.newTranscript = msg.text ?? ""
					clearTimeout(timer)
					setTimeout(done, 3000)
				}
			}
		})
		ws.on("error", done)
	})

const main = async (): Promise<void> => {
	const flagSet = FLAG_SETS[MODE]
	if (!flagSet) throw new Error(`unknown SOAK_MODE ${MODE}`)
	console.log(`=== voice-feel soak · mode=${MODE} · rounds=${ROUNDS} ===`)
	await applyFlags(flagSet)
	const rows: Record<string, unknown>[] = []
	let falseInterruptionRecovered = 0
	let bargeInEscalated = 0

	for (let round = 1; round <= ROUNDS; round++) {
		const plain = await satelliteTurn(`soak-${MODE}`, wavOf("s01"))
		const plainTrace = plain.replyDone
			? await waitTrace(plain.replyDone.interactionId)
			: undefined
		checker.check(
			`r${round} plain turn completes`,
			plain.replyDone !== null && plainTrace?.status === "ok",
			plain.error ?? plainTrace?.status,
		)
		if (plain.replyDone) {
			let ack = endpointAckStats(plain.replyDone.interactionId)
			for (let i = 0; i < 10 && ack.ackCount === 0; i++) {
				await sleep(500)
				ack = endpointAckStats(plain.replyDone.interactionId)
			}
			checker.check(
				`r${round} plain turn ack exactly-once`,
				ack.ackCount === 1 && ack.beforeSttFinal !== false,
				JSON.stringify(ack),
			)
			rows.push({
				round,
				kind: "plain",
				perceived: plainTrace?.perceived_ttfa_ms ?? null,
			})
		}

		const falseInt = await satelliteTurn(`soak-${MODE}`, wavOf("s10"), {
			bargeIn: { afterFrames: 0, speechMs: 700, thenSilenceMs: 2600 },
		})
		if (MODE === "pause" || MODE === "stack") {
			checker.check(
				`r${round} brief interruption pauses playback`,
				falseInt.pauses >= 1,
				`pauses=${falseInt.pauses}`,
			)
			if (falseInt.resumes >= 1) falseInterruptionRecovered += 1
		} else {
			checker.check(
				`r${round} barge-in interrupts (flag off)`,
				falseInt.pauses === 0,
				`pauses=${falseInt.pauses}`,
			)
		}
		rows.push({
			round,
			kind: "false-interruption",
			pauses: falseInt.pauses,
			resumes: falseInt.resumes,
			audioEnded: falseInt.audioEnded,
		})

		const bargeStart = new Date().toISOString().slice(0, 19).replace("T", " ")
		const barged = await satelliteTurn(`soak-${MODE}`, wavOf("s10"), {
			bargeIn: { afterFrames: 0, speechMs: 3500, thenSilenceMs: 1200 },
		})
		await sleep(2500)
		const bargedId =
			barged.replyDone?.interactionId ??
			queryOne<{ id: string }>(
				`SELECT t.id FROM interaction_trace t JOIN domia d ON d.id = t.domia_id
				 WHERE d.domia_key = ? AND t.created_at >= ? ORDER BY t.created_at DESC LIMIT 1`,
				[env.EVAL_DOMIA_KEY, bargeStart],
			)?.id
		const bargedTrace = bargedId ? await waitTrace(bargedId) : undefined
		checker.check(
			`r${round} sustained barge-in turn traceable`,
			bargedTrace !== undefined,
			bargedId ?? "no trace row",
		)
		if (bargedTrace) {
			const full = (bargedTrace.llm_response ?? "").trim()
			const heard = (bargedTrace.heard_reply ?? "").trim()
			if (MODE === "pause" || MODE === "stack") {
				checker.check(
					`r${round} sustained barge-in pauses and recovers (client-endpointing transport)`,
					barged.pauses >= 1 && bargedTrace.status === "ok",
					`pauses=${barged.pauses} status=${bargedTrace.status}`,
				)
			} else {
				checker.check(
					`r${round} sustained barge-in truncates heard reply`,
					heard.length < full.length || bargedTrace.status !== "ok",
					`heard=${heard.length} full=${full.length} status=${bargedTrace.status}`,
				)
			}
			if (heard.length < full.length) bargeInEscalated += 1
			if (MODE === "heard" || MODE === "stack") {
				checker.check(
					`r${round} heard reply is a clean prefix cut`,
					heard.length === 0 || full.startsWith(heard.slice(0, 20)),
					heard.slice(0, 40),
				)
			}
		}
		rows.push({
			round,
			kind: "sustained-barge-in",
			pauses: barged.pauses,
			heardLen: (bargedTrace?.heard_reply ?? "").length,
			fullLen: (bargedTrace?.llm_response ?? "").length,
			status: bargedTrace?.status ?? null,
		})
	}

	if (MODE === "pause" || MODE === "stack") {
		const escStart = new Date().toISOString().slice(0, 19).replace("T", " ")
		const esc = await liveEscalationProbe()
		await sleep(2000)
		const aborted = queryOne<{ n: number }>(
			`SELECT count(*) AS n FROM interaction_trace t JOIN domia d ON d.id = t.domia_id
			 WHERE d.domia_key = ? AND t.created_at >= ? AND t.status = 'aborted'`,
			[env.EVAL_DOMIA_KEY, escStart],
		)
		checker.check(
			"live-mode sustained speech escalates after pause (new transcript or original aborted)",
			esc.paused && (esc.newTranscript !== null || (aborted?.n ?? 0) >= 1),
			JSON.stringify({ ...esc, aborted: aborted?.n ?? 0 }),
		)
		rows.push({ kind: "live-escalation", ...esc, aborted: aborted?.n ?? 0 })
	}

	await applyFlags(FLAG_SETS.off)
	const summary = {
		mode: MODE,
		rounds: ROUNDS,
		pass: checker.passCount(),
		fail: checker.failCount(),
		falseInterruptionRecovered,
		bargeInEscalated,
		runtime: runtimeSnapshot(),
		rows,
	}
	const outFile = uniqueArtifactPath(OUT_DIR, `voice-feel-soak-${MODE}`)
	writeFileSync(outFile, JSON.stringify(summary, null, "\t"))
	console.log(
		`\n${summary.pass}/${summary.pass + summary.fail} soak checks passed · recovered=${falseInterruptionRecovered} escalated=${bargeInEscalated}`,
	)
	console.log(`saved → ${outFile}`)
	process.exit(summary.fail === 0 ? 0 : 1)
}

void main().catch((e) => {
	console.error(e)
	process.exit(1)
})
