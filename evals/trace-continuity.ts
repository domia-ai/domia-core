import { randomUUID } from "crypto"

import { env, meshHeaders, queryAll, sleep, waitForHealth } from "./lib"

const TRACE_ID_HEADER = "x-domia-trace-id"
const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ChatResultType = {
	interactionId: string
	reply: string
	responseTraceId: string | null
}

type InteractionRowType = {
	id: string
	traceId: string | null
}

type TurnEventTraceRowType = {
	type: string
	trace_id: string | null
}

const postChat = async (
	text: string,
	traceId?: string,
): Promise<ChatResultType> => {
	const res = await fetch(`${env.EVAL_URL}/chat`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...meshHeaders(),
			...(traceId ? { [TRACE_ID_HEADER]: traceId } : {}),
		},
		body: JSON.stringify({ domiaKey: env.EVAL_DOMIA_KEY, text }),
	})
	if (!res.ok) throw new Error(`/chat ${res.status}: ${await res.text()}`)
	const body = (await res.json()) as { interactionId: string; reply: string }
	return { ...body, responseTraceId: res.headers.get(TRACE_ID_HEADER) }
}

const getInteraction = async (
	interactionId: string,
): Promise<InteractionRowType> => {
	const res = await fetch(
		`${env.EVAL_URL}/interactions/${interactionId}?domiaKey=${env.EVAL_DOMIA_KEY}`,
		{ headers: meshHeaders() },
	)
	if (!res.ok)
		throw new Error(`GET /interactions/:id ${res.status}: ${await res.text()}`)
	const body = (await res.json()) as { interaction: InteractionRowType }
	return body.interaction
}

const turnEventTraces = async (
	interactionId: string,
): Promise<TurnEventTraceRowType[]> => {
	const start = Date.now()
	while (Date.now() - start < env.EVAL_POLL_TIMEOUT_MS) {
		const rows = queryAll<TurnEventTraceRowType>(
			"select type, trace_id from turn_event where interaction_id = ? order by seq",
			[interactionId],
		)
		if (rows.some((r) => r.type === "turn.completed")) return rows
		await sleep(250)
	}
	return []
}

const main = async (): Promise<void> => {
	if (!(await waitForHealth())) {
		console.error(`node at ${env.EVAL_URL} is not healthy`)
		process.exit(1)
	}

	const checks: [string, boolean, string][] = []
	const check = (name: string, ok: boolean, detail: string): void => {
		checks.push([name, ok, detail])
	}

	const supplied = `eval-trace-${randomUUID()}`
	const withHeader = await postChat("Say hi in three words.", supplied)
	const withHeaderRow = await getInteraction(withHeader.interactionId)
	check(
		"caller-supplied trace id is echoed on the response",
		withHeader.responseTraceId === supplied,
		`header=${withHeader.responseTraceId}`,
	)
	check(
		"caller-supplied trace id lands on the interaction row",
		withHeaderRow.traceId === supplied,
		`row.traceId=${withHeaderRow.traceId} expected=${supplied}`,
	)
	const withHeaderEvents = await turnEventTraces(withHeader.interactionId)
	check(
		"turn events carry the caller-supplied trace id",
		withHeaderEvents.length > 0 &&
			withHeaderEvents.every((e) => e.trace_id === supplied),
		withHeaderEvents.length
			? `events=${withHeaderEvents.length} traces=${[...new Set(withHeaderEvents.map((e) => e.trace_id))].join(",")}`
			: "no persisted turn events (turnEventsPersist off or timeout)",
	)

	const minted = await postChat("Say hi in three words.")
	const mintedRow = await getInteraction(minted.interactionId)
	check(
		"trace id is minted when the caller sends none",
		typeof mintedRow.traceId === "string" && UUID_RE.test(mintedRow.traceId),
		`row.traceId=${mintedRow.traceId}`,
	)
	check(
		"minted trace id is echoed on the response",
		minted.responseTraceId !== null &&
			minted.responseTraceId === mintedRow.traceId,
		`header=${minted.responseTraceId} row=${mintedRow.traceId}`,
	)
	check(
		"minted trace ids differ between turns",
		mintedRow.traceId !== withHeaderRow.traceId,
		`${mintedRow.traceId} vs ${withHeaderRow.traceId}`,
	)

	let failed = 0
	for (const [name, ok, detail] of checks) {
		console.log(`${ok ? "✅" : "❌"} ${name} (${detail})`)
		if (!ok) failed++
	}
	console.log(
		`${checks.length - failed}/${checks.length} trace-continuity checks passed`,
	)
	if (failed) process.exit(1)
}

void main()
