import { getLlmEngine } from "@/modules/llm-engine"
import type { LlmEngineEnumType } from "@/db"

import {
	env,
	makeChecker,
	meshHeaders,
	queryOne,
	sleep,
	stringOrEmpty,
} from "./lib"

type SseFrameType = {
	event: string
	data: Record<string, unknown>
}

type TraceRowType = {
	tool_call_count: number | null
	intent_decision: string | null
	status: string | null
}

const PROMPT = "tell me a two sentence bedtime story about a sleepy cat"
const EMOTION_TAG_RE = /\[\s*(?:EMOTION\s*:)?[a-z]+\s*\]/i

const checker = makeChecker()

const parseFrames = (raw: string): SseFrameType[] =>
	raw
		.split("\n\n")
		.filter((block) => block.trim().length > 0)
		.flatMap((block) => {
			const lines = block.split("\n")
			const event = lines.find((l) => l.startsWith("event: "))?.slice(7)
			const payload = lines.find((l) => l.startsWith("data: "))?.slice(6)
			if (!event) return []
			const data = payload
				? (JSON.parse(payload) as Record<string, unknown>)
				: {}
			return [{ event, data }]
		})

const engineStreams = (): boolean => {
	const row = queryOne<{ engine: string }>(
		`select engine from llm_model_config
		 where domia_id = (select id from domia where domia_key = ?) and is_active = 1
		 limit 1`,
		[env.EVAL_DOMIA_KEY],
	)
	if (!row) return false
	const adapter = getLlmEngine(row.engine as LlmEngineEnumType)
	return (
		adapter !== null &&
		adapter.capabilities.streaming &&
		typeof adapter.runStream === "function"
	)
}

const postChatStream = async (text: string): Promise<SseFrameType[]> => {
	const res = await fetch(`${env.EVAL_URL}/chat/stream`, {
		method: "POST",
		headers: { "content-type": "application/json", ...meshHeaders() },
		body: JSON.stringify({ domiaKey: env.EVAL_DOMIA_KEY, text }),
	})
	if (!res.ok)
		throw new Error(`/chat/stream ${res.status}: ${await res.text()}`)
	return parseFrames(await res.text())
}

const traceOf = async (interactionId: string): Promise<TraceRowType | null> => {
	const start = Date.now()
	while (Date.now() - start < env.EVAL_POLL_TIMEOUT_MS) {
		const row = queryOne<TraceRowType>(
			"select tool_call_count, intent_decision, status from interaction_trace where id = ?",
			[interactionId],
		)
		if (row?.status) return row
		await sleep(250)
	}
	return null
}

const main = async (): Promise<void> => {
	const streams = engineStreams()
	console.log(
		`llm engine streaming: ${streams ? "yes" : "no — single-delta fallback expected"}`,
	)

	const frames = await postChatStream(PROMPT)
	const names = frames.map((f) => f.event)
	console.log(`  frames: ${names.join(" ")}`)

	checker.check("RUN_STARTED is the first frame", names[0] === "RUN_STARTED")

	const runId = frames[0]?.data.runId
	checker.check(
		"RUN_STARTED carries a runId",
		typeof runId === "string" && runId.length > 0,
		String(runId),
	)

	const contents = frames.filter((f) => f.event === "TEXT_MESSAGE_CONTENT")
	checker.check(
		"at least one TEXT_MESSAGE_CONTENT",
		contents.length >= 1,
		`count=${contents.length}`,
	)

	const deltas = contents.map((f) => stringOrEmpty(f.data.delta))
	checker.check(
		"every delta is non-empty",
		deltas.length > 0 && deltas.every((d) => d.length > 0),
		JSON.stringify(deltas.slice(0, 3)),
	)

	const startIdx = names.indexOf("TEXT_MESSAGE_START")
	const firstContentIdx = names.indexOf("TEXT_MESSAGE_CONTENT")
	checker.check(
		"TEXT_MESSAGE_START precedes the first content frame",
		startIdx >= 0 && startIdx < firstContentIdx,
		`start=${startIdx} content=${firstContentIdx}`,
	)

	const endIdx = names.indexOf("TEXT_MESSAGE_END")
	const finishedIdx = names.indexOf("RUN_FINISHED")
	checker.check(
		"TEXT_MESSAGE_END precedes RUN_FINISHED",
		endIdx >= 0 && finishedIdx >= 0 && endIdx < finishedIdx,
		`end=${endIdx} finished=${finishedIdx}`,
	)
	checker.check(
		"RUN_FINISHED is the last frame",
		finishedIdx === names.length - 1,
		names.join(","),
	)

	const messageIds = new Set(
		frames
			.filter((f) => f.event.startsWith("TEXT_MESSAGE_"))
			.map((f) => String(f.data.messageId)),
	)
	checker.check(
		"one messageId across start/content/end",
		messageIds.size === 1,
		[...messageIds].join(","),
	)

	const text = deltas.join("")
	checker.check(
		"no emotion tag leaks into the deltas",
		!EMOTION_TAG_RE.test(text),
		text,
	)

	const trace = typeof runId === "string" ? await traceOf(runId) : null
	const routedToChat = (trace?.tool_call_count ?? 0) === 0
	console.log(
		`  intent=${trace?.intent_decision ?? "?"} tools=${trace?.tool_call_count ?? "?"}`,
	)

	if (streams && routedToChat) {
		checker.check(
			"more than one TEXT_MESSAGE_CONTENT frame (token streaming)",
			contents.length > 1,
			`count=${contents.length}`,
		)
	} else {
		console.log(
			`  ⏭️  multi-delta check skipped — ${streams ? "turn routed through tools" : "engine does not stream"}`,
		)
	}

	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} chat-stream checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
