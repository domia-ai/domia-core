import os from "os"
import path from "path"
import { readFileSync } from "fs"
import {
	env,
	ladder,
	queryOne,
	makeChecker,
	meshHeaders,
	postJson,
	satelliteTurn,
	sleep,
} from "./lib"
import type { LadderRowType } from "./types"

const BASE = env.EVAL_URL
const TERMINAL_TYPES = ["turn.completed", "turn.failed", "turn.aborted"]

const terminals = (rows: LadderRowType[]): LadderRowType[] =>
	rows.filter((r) => TERMINAL_TYPES.includes(r.type))

const types = (rows: LadderRowType[]): string[] => rows.map((r) => r.type)

const countType = (rows: LadderRowType[], t: string): number =>
	rows.filter((r) => r.type === t).length

const { check, passCount, failCount } = makeChecker()

const lanBase = (): string | null => {
	const port = new URL(BASE).port
	for (const ifaces of Object.values(os.networkInterfaces())) {
		for (const iface of ifaces ?? []) {
			if (iface.family === "IPv4" && !iface.internal) {
				return `http://${iface.address}:${port}`
			}
		}
	}
	return null
}

const runAuthSection = async (): Promise<void> => {
	console.log("[11] mesh auth (requires DOMIA_MESH_SECRET set on the node)")
	const lan = lanBase()
	if (lan) {
		const noAuth = await fetch(`${lan}/presence`).catch(() => null)
		check(
			"LAN no token → 401",
			noAuth?.status === 401,
			`${lan} → ${noAuth?.status ?? "unreachable"}`,
		)
		const lanAuth = await fetch(`${lan}/presence`, {
			headers: meshHeaders(),
		}).catch(() => null)
		check("LAN token → 200", lanAuth?.status === 200, String(lanAuth?.status))
	} else {
		console.log("  ⏭  no LAN interface found — skipping 401 check")
	}
	const loopback = await fetch(`${BASE}/presence`)
	check(
		"loopback exempt → 200",
		loopback.status === 200,
		String(loopback.status),
	)
	const withAuth = await fetch(`${BASE}/presence`, { headers: meshHeaders() })
	check("token → 200", withAuth.status === 200, String(withAuth.status))
	const health = await fetch(`${BASE}/health`)
	check("health exempt → 200", health.status === 200, String(health.status))
	const lan2 = lanBase()
	if (lan2) {
		const badWs = await satelliteTurn(
			"e2e-auth-sat",
			path.resolve("evals/fixtures/g03.wav"),
			{
				token: "wrong-token",
				wsUrl: `${lan2.replace(/^http/, "ws")}/satellite`,
			},
		)
		check(
			"LAN WS bad token rejected",
			badWs.error !== null && !badWs.replyDone,
			badWs.error ?? "no error",
		)
	}
}

type ChatResponseType = {
	interactionId: string
	reply?: string
	audioUrl?: string
}

const run = async (): Promise<void> => {
	console.log(`\n=== runtime E2E — ${BASE} / ${env.EVAL_DB} ===\n`)

	if (env.E2E_ONLY === "auth") {
		await runAuthSection()
		console.log(`\n=== ${passCount()} passed, ${failCount()} failed ===`)
		if (failCount() > 0) process.exit(1)
		return
	}

	console.log("[1] text → text")
	{
		const r = await postJson<ChatResponseType>("/chat", {
			text: "name a color in one word",
		})
		await sleep(1500)
		const rows = ladder(r.interactionId)
		const t = types(rows)
		check("has turn.started", t.includes("turn.started"))
		check("has stt.final", t.includes("stt.final"))
		check(
			"has stage.started(context)",
			rows.some(
				(x) => x.type === "stage.started" && x.payload.includes("context"),
			),
		)
		check(
			"has exactly one turn.completed",
			countType(rows, "turn.completed") === 1,
			`got ${countType(rows, "turn.completed")}`,
		)
		check(
			"source is http",
			rows.some(
				(x) => x.type === "turn.started" && x.payload.includes('"http"'),
			),
		)
		check(
			"all stage.done carry status",
			rows
				.filter((x) => x.type === "stage.done")
				.every((x) => x.payload.includes("status")),
		)
	}

	console.log("[2] voice dispatch (/chat speak:true, no local playback)")
	{
		const r = await postJson<ChatResponseType>("/chat", {
			text: "say hi briefly",
			speak: true,
		})
		await sleep(2000)
		const rows = ladder(r.interactionId)
		check(
			"has audioUrl artifact",
			typeof r.audioUrl === "string" && r.audioUrl.length > 0,
		)
		check(
			"exactly one turn.completed",
			countType(rows, "turn.completed") === 1,
			`got ${countType(rows, "turn.completed")}`,
		)
		check(
			"turn.completed carries ttsMs",
			rows.some(
				(x) => x.type === "turn.completed" && x.payload.includes("ttsMs"),
			),
		)
	}

	console.log("[3] skill turn (requires HA provider)")
	{
		const r = await postJson<ChatResponseType>("/chat", {
			text: "turn on the front foyer main lights",
		})
		await sleep(3000)
		const rows = ladder(r.interactionId)
		const t = types(rows)
		const isSkill = rows.some(
			(x) => x.type === "intent.decided" && x.payload.includes("skill"),
		)
		if (!isSkill) {
			console.log(
				"  ⏭  not routed as skill (HA absent or model chose chat) — skipping skill asserts",
			)
		} else {
			check(
				"has stage(skills)",
				rows.some(
					(x) => x.type === "stage.started" && x.payload.includes("skills"),
				),
			)
			check("has tool.requested", t.includes("tool.requested"))
			check(
				"exactly one turn.completed",
				countType(rows, "turn.completed") === 1,
				`got ${countType(rows, "turn.completed")}`,
			)
		}
	}

	console.log("[4] no-speech (empty transcript)")
	{
		const r = await postJson<ChatResponseType>("/chat", { text: "   " }).catch(
			() => null,
		)
		if (r?.interactionId) {
			await sleep(1000)
			const rows = ladder(r.interactionId)
			check(
				"no-speech terminates (completed or no rows)",
				countType(rows, "turn.completed") <= 1,
			)
		} else {
			console.log("  ⏭  empty text rejected at entry — ok")
		}
	}

	console.log(
		"[5] 'yes' with no pending confirmation → plain chat, no actuation",
	)
	{
		const r = await postJson<ChatResponseType>("/chat", { text: "yes" })
		await sleep(1500)
		const rows = ladder(r.interactionId)
		check("replies normally", typeof r.reply === "string" && r.reply.length > 0)
		check("no tool executed", countType(rows, "tool.result") === 0)
		check("exactly one turn.completed", countType(rows, "turn.completed") === 1)
	}

	if (env.E2E_SAT === "1") {
		console.log("[7] satellite native WS turn")
		{
			const r = await satelliteTurn(
				"e2e-sat",
				path.resolve("evals/fixtures/g03.wav"),
			)
			check("ready received", r.ready)
			check("no gateway error", r.error === null, r.error ?? "")
			check(
				"transcript received",
				typeof r.transcript === "string" && r.transcript.length > 0,
			)
			check("audio stream began", r.audioBegan)
			check("audio frames received", r.audioFrames > 0)
			check("audio stream ended", r.audioEnded)
			check("reply_done received", r.replyDone !== null)
			if (r.replyDone) {
				await sleep(2000)
				const rows = ladder(r.replyDone.interactionId)
				check(
					"source is satellite",
					rows.some(
						(x) =>
							x.type === "turn.started" && x.payload.includes('"satellite"'),
					),
				)
				check(
					"exactly one terminal",
					terminals(rows).length === 1,
					JSON.stringify(terminals(rows).map((t) => t.type)),
				)
				const satRow = queryOne<{ satellite_id: string }>(
					"SELECT satellite_id FROM interaction_trace WHERE id = ?",
					[r.replyDone.interactionId],
				)
				check(
					"satellite_id on trace",
					satRow?.satellite_id === "e2e-sat",
					satRow?.satellite_id ?? "missing",
				)
			}
		}

		console.log("[8] satellite disconnect mid-turn (persister-drop regression)")
		{
			const t0 = new Date().toISOString().slice(0, 19).replace("T", " ")
			await satelliteTurn(
				"e2e-sat-disc",
				path.resolve("evals/fixtures/g05.wav"),
				{ disconnectAfterSpeechEnd: true },
			)
			await sleep(4000)
			const row = queryOne<{ id: string; status: string }>(
				"SELECT id, status FROM interaction_trace WHERE satellite_id = 'e2e-sat-disc' AND created_at >= ? ORDER BY created_at DESC LIMIT 1",
				[t0],
			)
			check("interaction row created", Boolean(row?.id))
			if (row) {
				check(
					"trace status is terminal",
					["aborted", "failed", "ok"].includes(row.status),
					row.status,
				)
				const rows = ladder(row.id)
				const term = terminals(rows)
				check(
					"exactly one terminal event",
					term.length === 1,
					JSON.stringify(term.map((t) => t.type)),
				)
				check(
					"terminal is not a clean completion",
					!(
						term[0]?.type === "turn.completed" &&
						term[0]?.payload.includes('"ok"')
					),
					term[0]?.payload ?? "no terminal",
				)
			}
		}
	} else {
		console.log("[7-8] ⏭  satellite sections skipped (set E2E_SAT=1)")
	}

	console.log("[9] console-stop abort (/turn/cancel)")
	{
		const wav = readFileSync(path.resolve("evals/fixtures/g05.wav"))
		const t0 = new Date().toISOString().slice(0, 19).replace("T", " ")
		const voicePromise = postJson<ChatResponseType>("/voice", {
			audioBase64: wav.toString("base64"),
			speak: false,
			domiaKey: env.EVAL_DOMIA_KEY,
		}).catch(() => null)
		await sleep(300)
		const cancel = await postJson<{ aborted: boolean }>("/turn/cancel", {
			domiaKey: env.EVAL_DOMIA_KEY,
		})
		await voicePromise
		await sleep(2000)
		check(
			"cancel acknowledged",
			cancel.aborted === true,
			JSON.stringify(cancel),
		)
		if (cancel.aborted === true) {
			const row = queryOne<{ id: string }>(
				"SELECT id FROM interaction_trace WHERE status = 'aborted' AND created_at >= ? ORDER BY created_at DESC LIMIT 1",
				[t0],
			)
			check("aborted trace row exists", Boolean(row?.id))
			if (row) {
				const rows = ladder(row.id)
				const term = terminals(rows)
				check(
					"exactly one terminal event",
					term.length === 1,
					JSON.stringify(term.map((t) => t.type)),
				)
				check(
					"no clean completion",
					!(
						term[0]?.type === "turn.completed" &&
						term[0]?.payload.includes('"ok"')
					),
					term[0]?.payload ?? "",
				)
			}
		}
	}

	console.log("[10] tool failure surfaces cleanly (requires HA)")
	{
		const r = await postJson<ChatResponseType>("/chat", {
			text: "turn on the flying carpet in the dungeon",
		})
		await sleep(2500)
		const rows = ladder(r.interactionId)
		const toolResults = rows.filter((x) => x.type === "tool.result")
		if (toolResults.length === 0) {
			console.log("  ⏭  not routed to a tool — skipping failure asserts")
		} else {
			check(
				"tool.result is failed",
				toolResults.some((x) => x.payload.includes('"failed"')),
				toolResults[0]?.payload,
			)
			check(
				"reply non-empty (no hang)",
				typeof r.reply === "string" && r.reply.length > 0,
			)
			check(
				"exactly one turn.completed",
				countType(rows, "turn.completed") === 1,
			)
		}
	}

	if (env.E2E_AUTH === "1") {
		await runAuthSection()
	} else {
		console.log("[11] ⏭  auth section skipped (set E2E_AUTH=1)")
	}

	if (env.E2E_B_URL && env.E2E_B_DB) {
		console.log(`[6] delegated text turn — ${env.E2E_B_URL} (thin) → hub`)
		const res = await fetch(`${env.E2E_B_URL}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...meshHeaders() },
			body: JSON.stringify({ text: "name one planet in one word" }),
		})
		const r = (await res.json()) as ChatResponseType
		await sleep(2000)
		const bDb = env.E2E_B_DB
		const { default: Database } = await import("better-sqlite3")
		const db = new Database(bDb, { readonly: true, fileMustExist: true })
		try {
			const bLadder = db
				.prepare(
					"SELECT type FROM turn_event WHERE interaction_id = ? ORDER BY created_at, id",
				)
				.all(r.interactionId) as { type: string }[]
			const executor = db
				.prepare("SELECT llm_executor_key FROM interaction_trace WHERE id = ?")
				.get(r.interactionId) as { llm_executor_key: string } | undefined
			check(
				"delegated reply returned",
				typeof r.reply === "string" && r.reply.length > 0,
			)
			check(
				"origin ladder has turn.started",
				bLadder.some((x) => x.type === "turn.started"),
			)
			check(
				"origin ladder has exactly one turn.completed",
				bLadder.filter((x) => x.type === "turn.completed").length === 1,
			)
			check("executor is a remote peer", Boolean(executor?.llm_executor_key))
		} finally {
			db.close()
		}
	} else {
		console.log(
			"[6] ⏭  delegation skipped (set E2E_B_URL + E2E_B_DB to a thin node)",
		)
	}

	console.log(`\n=== ${passCount()} passed, ${failCount()} failed ===`)
	if (failCount() > 0) process.exit(1)
}

void run().catch((err) => {
	console.error("harness error", err)
	process.exit(1)
})
