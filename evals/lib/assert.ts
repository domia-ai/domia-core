import type {
	EvalTurnRecordType,
	EvalExpectType,
	EvalAssertionType,
	CheckerType,
} from "../types"

export const makeChecker = (): CheckerType => {
	let pass = 0
	let fail = 0
	return {
		check: (name, cond, detail = "") => {
			if (cond) {
				pass++
				console.log(`  \u2705 ${name}`)
			} else {
				fail++
				console.log(`  \u274c ${name} ${detail}`)
			}
		},
		passCount: () => pass,
		failCount: () => fail,
	}
}

const toolEntries = (
	rec: EvalTurnRecordType,
): {
	tool?: string
	kind?: string
	resolvedArgs?: Record<string, unknown>
	args?: Record<string, unknown>
}[] =>
	(rec.skillResponse ?? []).filter(
		(e): e is { tool?: string } =>
			e !== null && typeof e === "object" && "tool" in e,
	)

const resultEntries = (
	rec: EvalTurnRecordType,
): { tool?: string; kind?: string }[] =>
	toolEntries(rec).filter(
		(e) => e.kind === "result" || e.kind === "async_outcome",
	)

const summaryEntry = (
	rec: EvalTurnRecordType,
): { finalizeMode?: string; stopReason?: string } | undefined =>
	(rec.skillResponse ?? []).find(
		(e): e is { kind: string; finalizeMode?: string; stopReason?: string } =>
			e !== null &&
			typeof e === "object" &&
			(e as { kind?: string }).kind === "summary",
	)

const rawName = (t: string): string => {
	const i = t.indexOf("__")
	return i >= 0 ? t.slice(i + 2) : t
}

const deepSubset = (
	subset: Record<string, unknown>,
	actual: unknown,
): boolean => {
	if (!actual || typeof actual !== "object") return false
	const a = actual as Record<string, unknown>
	return Object.entries(subset).every(([k, v]) => {
		if (v !== null && typeof v === "object")
			return deepSubset(v as Record<string, unknown>, a[k])
		return a[k] === v
	})
}

const promptSectionBody = (prompt: string, section: string): string => {
	const lines = prompt.split("\n")
	const start = lines.findIndex((l) => l === `### ${section}`)
	if (start < 0) return ""
	const body: string[] = []
	for (let i = start + 1; i < lines.length; i++) {
		if (/^### /.test(lines[i])) break
		body.push(lines[i])
	}
	return body.join("\n").trim()
}

export const assertTurn = (
	rec: EvalTurnRecordType,
	reply: string,
	expect: EvalExpectType,
): EvalAssertionType[] => {
	const out: EvalAssertionType[] = []
	const add = (name: string, ok: boolean, detail?: string): void => {
		out.push({ name, ok, detail })
	}
	const tools = toolEntries(rec)
	const toolNames = tools.map((t) => t.tool ?? "")

	if (expect.routed === "skill")
		add(
			"routed=skill",
			(rec.toolCallCount ?? 0) > 0 || /skill/i.test(rec.intentDecision ?? ""),
			`intent=${rec.intentDecision} tools=${rec.toolCallCount}`,
		)
	if (expect.routed === "chat")
		add(
			"routed=chat",
			(rec.toolCallCount ?? 0) === 0,
			`tools=${rec.toolCallCount}`,
		)
	if (expect.routed === "fast")
		add("routed=fast", rec.llmMs === null, `llmMs=${rec.llmMs}`)

	if (expect.fastPath === true)
		add(
			"fastPath=true",
			(rec.intentDecision ?? "").startsWith("fast-path") && rec.llmMs === null,
			`intent=${rec.intentDecision} llmMs=${rec.llmMs}`,
		)
	if (expect.fastPath === false)
		add(
			"fastPath=false",
			!(rec.intentDecision ?? "").startsWith("fast-path"),
			`intent=${rec.intentDecision}`,
		)

	const wantedTools = expect.tool
		? Array.isArray(expect.tool)
			? expect.tool
			: [expect.tool]
		: null
	if (wantedTools)
		add(
			`tool=${wantedTools.join("|")}`,
			toolNames.some((t) => wantedTools.includes(rawName(t))),
			`got=${toolNames.join(",")}`,
		)
	if (expect.notTools) {
		const banned = expect.notTools
		add(
			`notTools`,
			!toolNames.some((t) => banned.includes(rawName(t))),
			`got=${toolNames.join(",")}`,
		)
	}

	if (expect.anyArgMatches) {
		const allArgs = tools.map((t) =>
			JSON.stringify(t.resolvedArgs ?? t.args ?? {}),
		)
		add(
			`anyArgMatches~/${expect.anyArgMatches}/`,
			allArgs.some((a) =>
				new RegExp(expect.anyArgMatches as string, "i").test(a),
			),
			`args=${allArgs.join(" ")}`,
		)
	}

	if (expect.argsSubset || expect.argMatchers) {
		const target = tools.find(
			(t) => !wantedTools || wantedTools.includes(rawName(t.tool ?? "")),
		)
		const resolved = (target?.resolvedArgs ?? target?.args ?? {}) as Record<
			string,
			unknown
		>
		if (expect.argsSubset)
			add(
				"argsSubset",
				deepSubset(expect.argsSubset, resolved),
				JSON.stringify(resolved),
			)
		if (expect.argMatchers)
			for (const [k, pat] of Object.entries(expect.argMatchers))
				add(
					`argMatch:${k}~/${pat}/`,
					new RegExp(pat, "i").test(String(resolved[k] ?? "")),
					`${k}=${String(resolved[k])}`,
				)
	}

	if (expect.replyIncludes)
		for (const s of expect.replyIncludes)
			add(
				`replyIncludes:${s}`,
				reply.toLowerCase().includes(s.toLowerCase()),
				reply,
			)

	if (expect.replyExcludes)
		for (const s of expect.replyExcludes)
			add(
				`replyExcludes:${s}`,
				!reply.toLowerCase().includes(s.toLowerCase()),
				reply,
			)

	if (expect.maxReplyWords !== undefined) {
		const words = reply.trim().split(/\s+/).filter(Boolean).length
		add(
			`maxReplyWords:${expect.maxReplyWords}`,
			words <= expect.maxReplyWords,
			`${words} words — ${reply}`,
		)
	}

	const prompt = rec.llmPrompt ?? ""
	if (expect.promptIncludes)
		for (const s of expect.promptIncludes)
			add(
				`promptIncludes:${s}`,
				prompt.toLowerCase().includes(s.toLowerCase()),
				prompt ? "(not in prompt)" : "(no prompt stored)",
			)

	if (expect.promptSection) {
		const { section, includes } = expect.promptSection
		const body = promptSectionBody(prompt, section)
		for (const s of includes)
			add(
				`promptSection[${section}]:${s}`,
				body.toLowerCase().includes(s.toLowerCase()),
				body ? `section="${body.slice(0, 80)}"` : "(section absent)",
			)
	}

	if (expect.recallsFact) {
		const body = promptSectionBody(prompt, "WHAT YOU KNOW")
		const v = expect.recallsFact.value.toLowerCase()
		const subj = expect.recallsFact.subject?.toLowerCase()
		add(
			`recallsFact:${expect.recallsFact.value}`,
			body.toLowerCase().includes(v) &&
				(!subj || body.toLowerCase().includes(subj)),
			body ? `WHAT YOU KNOW="${body.slice(0, 100)}"` : "(no facts recalled)",
		)
	}

	if (expect.maxTtfaMs != null)
		add(
			`ttfa<=${expect.maxTtfaMs}`,
			(rec.ttfaMs ?? Infinity) <= expect.maxTtfaMs,
			`ttfa=${rec.ttfaMs}`,
		)

	if (expect.calledToolCount != null)
		add(
			`calledToolCount=${expect.calledToolCount}`,
			resultEntries(rec).length === expect.calledToolCount,
			`got=${resultEntries(rec).length}`,
		)

	if (expect.traceToolStatus)
		for (const [tool, status] of Object.entries(expect.traceToolStatus)) {
			const entries = resultEntries(rec).filter(
				(e) => rawName(e.tool ?? "") === tool,
			)
			add(
				`traceStatus[${tool}]=${status}`,
				entries.some((e) => (e as { status?: string }).status === status),
				`got=${entries.map((e) => (e as { status?: string }).status).join(",")}`,
			)
		}

	if (expect.exactlyOnce) {
		const hits = resultEntries(rec).filter(
			(t) => rawName(t.tool ?? "") === expect.exactlyOnce,
		)
		add(
			`exactlyOnce:${expect.exactlyOnce}`,
			hits.length === 1,
			`count=${hits.length}`,
		)
	}

	if (expect.stageOrder) {
		const types = rec.events.map((e) => e.type)
		let cursor = -1
		const ordered = expect.stageOrder.every((t) => {
			const i = types.indexOf(t, cursor + 1)
			if (i < 0) return false
			cursor = i
			return true
		})
		add(
			`stageOrder:${expect.stageOrder.join(">")}`,
			ordered,
			`events=${types.join(",")}`,
		)
	}

	if (expect.maxDecisionMs != null)
		add(
			`decisionMs<=${expect.maxDecisionMs}`,
			(rec.agentDecisionMs ?? Infinity) <= expect.maxDecisionMs,
			`decisionMs=${rec.agentDecisionMs}`,
		)
	if (expect.maxToolMs != null)
		add(
			`toolMs<=${expect.maxToolMs}`,
			(rec.agentToolMs ?? Infinity) <= expect.maxToolMs,
			`toolMs=${rec.agentToolMs}`,
		)
	if (expect.maxFinalizeMs != null)
		add(
			`finalizeMs<=${expect.maxFinalizeMs}`,
			(rec.agentFinalizeMs ?? Infinity) <= expect.maxFinalizeMs,
			`finalizeMs=${rec.agentFinalizeMs}`,
		)

	if (expect.expectFinalizeMode || expect.expectStopReason) {
		const summary = summaryEntry(rec)
		if (expect.expectFinalizeMode)
			add(
				`finalizeMode=${expect.expectFinalizeMode}`,
				summary?.finalizeMode === expect.expectFinalizeMode,
				`got=${summary?.finalizeMode}`,
			)
		if (expect.expectStopReason)
			add(
				`stopReason=${expect.expectStopReason}`,
				summary?.stopReason === expect.expectStopReason,
				`got=${summary?.stopReason}`,
			)
	}

	if (expect.status)
		add(
			`status=${expect.status}`,
			rec.status === expect.status,
			`status=${rec.status}`,
		)

	const ev = expect.expectEvents
	if (ev) {
		const types = rec.events.map((e) => e.type)
		if (ev.present)
			for (const t of ev.present)
				add(`event:${t}`, types.includes(t), `events=${types.join(",")}`)
		if (ev.toolResultStatus) {
			const statuses = rec.events
				.filter((e) => e.type === "tool.result")
				.map((e) => {
					try {
						return (JSON.parse(e.payload ?? "") as { status?: string }).status
					} catch {
						return undefined
					}
				})
			add(
				`toolResultStatus=${ev.toolResultStatus}`,
				statuses.includes(ev.toolResultStatus),
				`statuses=${statuses.map((s) => s ?? "?").join(",")}`,
			)
		}
		if (ev.toolResultStatusFor) {
			const results = rec.events
				.filter((e) => e.type === "tool.result")
				.map((e) => {
					try {
						return JSON.parse(e.payload ?? "") as {
							toolName?: string
							status?: string
						}
					} catch {
						return {}
					}
				})
			for (const [tool, status] of Object.entries(ev.toolResultStatusFor))
				add(
					`toolResultStatus[${tool}]=${status}`,
					results.some(
						(r) => rawName(r.toolName ?? "") === tool && r.status === status,
					),
					`results=${results.map((r) => `${r.toolName}:${r.status}`).join(",")}`,
				)
		}
		if (ev.seqOrdered) {
			const seqs = rec.events.map((e) => e.seq)
			add(
				"seqOrdered",
				seqs.every((s, i) => i === 0 || s > seqs[i - 1]),
				seqs.join(","),
			)
		}
		if (ev.completedAfterPlayback) {
			const pf = rec.events.find((e) => e.type === "playback.finished")?.seq
			const tc = rec.events.find((e) => e.type === "turn.completed")?.seq
			add(
				"completedAfterPlayback",
				pf == null || tc == null || tc > pf,
				`pf=${pf} tc=${tc}`,
			)
		}
	}

	return out
}

const normalizeReply = (s: string): string =>
	s
		.toLowerCase()
		.replace(/[^\w\s]/g, "")
		.replace(/\s+/g, " ")
		.trim()

export const assertCoherence = (
	reply: string,
	userText: string,
	priorReplies: string[],
	expect: EvalExpectType,
): EvalAssertionType[] => {
	const out: EvalAssertionType[] = []
	const norm = normalizeReply(reply)
	if (expect.noRepeat) {
		const repeated = priorReplies.some((p) => {
			const pn = normalizeReply(p)
			if (pn.length === 0) return false
			if (pn === norm) return true
			if (pn.length > 20 && norm.includes(pn)) return true
			return norm.length > 20 && pn.includes(norm)
		})
		out.push({
			name: "noRepeat",
			ok: !repeated,
			detail: repeated ? reply : undefined,
		})
	}
	if (expect.noEcho) {
		const un = normalizeReply(userText)
		const echoed =
			un.length > 0 && (norm === un || (un.length > 12 && norm.includes(un)))
		out.push({
			name: "noEcho",
			ok: !echoed,
			detail: echoed ? reply : undefined,
		})
	}
	return out
}
