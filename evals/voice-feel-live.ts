import type { VoiceFeelSnapshotType } from "@/modules/voice-feel"

import {
	BENCH_DOMIA_KEY,
	ensureBenchIdentity,
	env,
	execWrite,
	makeChecker,
	meshHeaders,
	queryOne,
	sleep,
	teardownBenchIdentity,
	waitForHealth,
} from "./lib"

const SEED_TURNS = 20
const TICK_MS = 1000
const MIN_TURNS = 5
const SETTLE_MS = 6000
const COMPLETE_UTTERANCE = "turn on the kitchen light."
const LONG_REPLY =
	"Sure, the kitchen light is on now and I dimmed it to a comfortable level for the evening."
const HEARD_PREFIX = "Sure,"

const checker = makeChecker()

const configOf = async (): Promise<Record<string, unknown>> => {
	const res = await fetch(
		`${env.EVAL_URL}/config?domiaKey=${encodeURIComponent(BENCH_DOMIA_KEY)}`,
		{ headers: meshHeaders() },
	)
	if (!res.ok) throw new Error(`GET /config ${res.status}`)
	const body = (await res.json()) as { config?: Record<string, unknown> }
	return body.config ?? {}
}

const postConfig = async (bundle: unknown): Promise<number> => {
	const res = await fetch(
		`${env.EVAL_URL}/config?domiaKey=${encodeURIComponent(BENCH_DOMIA_KEY)}`,
		{
			method: "POST",
			headers: { "content-type": "application/json", ...meshHeaders() },
			body: JSON.stringify(bundle),
		},
	)
	return res.status
}

const benchDomiaId = (): string => {
	const row = queryOne<{ id: string }>(
		"SELECT id FROM domia WHERE domia_key = ?",
		[BENCH_DOMIA_KEY],
	)
	if (!row) throw new Error("bench identity has no domia row")
	return row.id
}

const seedBargeInWindow = (domiaId: string): void => {
	const sessionTraceId = `voice-feel-eval-session`
	execWrite(
		`INSERT OR REPLACE INTO interaction_session_trace (id, domia_id, session_id, created_at, updated_at)
		 VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
		[sessionTraceId, domiaId, "voice-feel-eval"],
	)
	for (let i = 0; i < SEED_TURNS; i++) {
		execWrite(
			`INSERT OR REPLACE INTO interaction_trace
			 (id, domia_id, interaction_session_trace_id, session_id, stt_result, llm_response, heard_reply,
			  implicit_feedback, abort_reason, eou_delay_ms, perceived_ttfa_ms, status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 'barge_in', 'satellite-bargein', 400, 900, 'ok', datetime('now'), datetime('now'))`,
			[
				`voice-feel-eval-${i}`,
				domiaId,
				sessionTraceId,
				"voice-feel-eval",
				COMPLETE_UTTERANCE,
				LONG_REPLY,
				HEARD_PREFIX,
			],
		)
	}
}

const clearSeed = (): void => {
	execWrite("DELETE FROM interaction_trace WHERE id LIKE 'voice-feel-eval-%'")
	execWrite(
		"DELETE FROM interaction_session_trace WHERE id = 'voice-feel-eval-session'",
	)
}

const recommendation = (
	domiaId: string,
):
	| { rule: string; section: string; field: string; applied: string | null }
	| undefined =>
	queryOne(
		`SELECT rule, section, field, applied_at AS applied
		 FROM voice_feel_adjustment WHERE domia_id = ? ORDER BY created_at DESC LIMIT 1`,
		[domiaId],
	)

const adjustmentRow = (
	id: string,
): {
	applied: string | null
	reverted: string | null
	revision: number | null
} =>
	queryOne(
		`SELECT applied_at AS applied, reverted_at AS reverted, config_revision AS revision
		 FROM voice_feel_adjustment WHERE id = ?`,
		[id],
	) ?? { applied: null, reverted: null, revision: null }

const voiceFeel = async (): Promise<VoiceFeelSnapshotType> => {
	const res = await fetch(
		`${env.EVAL_URL}/voice-feel?domiaKey=${encodeURIComponent(BENCH_DOMIA_KEY)}`,
		{ headers: meshHeaders() },
	)
	if (!res.ok) throw new Error(`GET /voice-feel ${res.status}`)
	return (await res.json()) as VoiceFeelSnapshotType
}

const mutateAdjustment = async (
	action: "apply" | "revert",
	id: string,
): Promise<number> => {
	const res = await fetch(
		`${env.EVAL_URL}/voice-feel/${action}/${encodeURIComponent(id)}?domiaKey=${encodeURIComponent(BENCH_DOMIA_KEY)}`,
		{ method: "POST", headers: meshHeaders() },
	)
	return res.status
}

const vadMinSilence = async (): Promise<number | null> => {
	const wakeWord = (await configOf()).wakeWord as
		| Record<string, unknown>
		| undefined
	const value = wakeWord?.vadMinSilenceS
	return typeof value === "number" ? value : null
}

const main = async (): Promise<void> => {
	await waitForHealth()
	await ensureBenchIdentity()
	const domiaId = benchDomiaId()
	clearSeed()
	seedBargeInWindow(domiaId)

	const armed = await postConfig({
		modules: {
			voiceFeelAutotuneEnabled: true,
			voiceFeelTickMs: TICK_MS,
			voiceFeelMinTurns: MIN_TURNS,
			voiceFeelWindowTurns: SEED_TURNS,
		},
	})
	checker.check(
		"autotuner can be armed through /config",
		armed === 200,
		String(armed),
	)

	const before = await configOf()
	await sleep(SETTLE_MS)
	const after = await configOf()

	checker.check(
		"advisory mode never writes configuration",
		JSON.stringify(before) === JSON.stringify(after),
		"config changed while the autotuner was advisory",
	)

	const row = recommendation(domiaId)
	checker.check(
		"a recommendation row was persisted",
		row !== undefined,
		"(no voice_feel_adjustment row)",
	)
	checker.check(
		"the recommendation targets a live wake-word knob",
		row?.section === "wakeWord" && row.field === "vadMinSilenceS",
		JSON.stringify(row),
	)
	checker.check(
		"the recommendation is unapplied",
		row?.applied === null,
		String(row?.applied),
	)

	const snapshot = await voiceFeel()
	const advice = snapshot.adjustments.at(0)
	checker.check(
		"GET /voice-feel reports the armed autotuner and its window",
		snapshot.enabled &&
			snapshot.settings.windowTurns === SEED_TURNS &&
			snapshot.features.turns === SEED_TURNS,
		JSON.stringify({ enabled: snapshot.enabled, features: snapshot.features }),
	)
	checker.check(
		"GET /voice-feel lists the recommendation with its evidence",
		advice?.section === "wakeWord" &&
			advice.field === "vadMinSilenceS" &&
			advice.sampleSize === SEED_TURNS &&
			advice.confidence > 0 &&
			advice.appliedAt === null &&
			advice.revertedAt === null,
		JSON.stringify(advice ?? null),
	)
	checker.check(
		"GET /voice-feel accounts for the daily budget and the knob cooldown",
		snapshot.budgetUsedToday === 1 &&
			snapshot.cooldowns.some(
				(c) => c.section === "wakeWord" && c.field === "vadMinSilenceS",
			),
		JSON.stringify({
			budgetUsedToday: snapshot.budgetUsedToday,
			cooldowns: snapshot.cooldowns,
		}),
	)

	if (advice) {
		const drifted = Number((advice.from + 0.02).toFixed(3))
		await postConfig({ wakeWord: { vadMinSilenceS: drifted } })
		checker.check(
			"apply of a stale recommendation → 409",
			(await mutateAdjustment("apply", advice.id)) === 409,
			"the knob moved under the recommendation and it was applied anyway",
		)
		await postConfig({ wakeWord: { vadMinSilenceS: advice.from } })

		const applied = await mutateAdjustment("apply", advice.id)
		const afterApply = await vadMinSilence()
		const appliedRow = adjustmentRow(advice.id)
		checker.check("apply → 200", applied === 200, String(applied))
		checker.check(
			"the knob now holds the recommended value",
			afterApply === advice.to,
			`${afterApply} != ${advice.to}`,
		)
		checker.check(
			"the row records applied_at and the config revision",
			appliedRow.applied !== null && typeof appliedRow.revision === "number",
			JSON.stringify(appliedRow),
		)
		checker.check(
			"a second apply → 409",
			(await mutateAdjustment("apply", advice.id)) === 409,
			"an already-applied recommendation was applied twice",
		)

		const reverted = await mutateAdjustment("revert", advice.id)
		const afterRevert = await vadMinSilence()
		const revertedRow = adjustmentRow(advice.id)
		checker.check("revert → 200", reverted === 200, String(reverted))
		checker.check(
			"the knob is back at its original value",
			afterRevert === advice.from,
			`${afterRevert} != ${advice.from}`,
		)
		checker.check(
			"the row records reverted_at",
			revertedRow.reverted !== null,
			JSON.stringify(revertedRow),
		)
		checker.check(
			"a second revert → 409",
			(await mutateAdjustment("revert", advice.id)) === 409,
			"an already-reverted recommendation was reverted twice",
		)
	}

	await postConfig({ modules: { voiceFeelAutotuneEnabled: false } })
	clearSeed()
	await teardownBenchIdentity()
	console.log(
		`\nvoice-feel-live: ${checker.passCount()} passed, ${checker.failCount()} failed`,
	)
	if (checker.failCount() > 0) process.exit(1)
}

void main()
