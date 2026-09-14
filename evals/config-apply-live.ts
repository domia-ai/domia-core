import { env, meshHeaders, waitForHealth, postChat, makeChecker } from "./lib"
import type { ApplyResponseType, ConfigApplyProbeCaseType } from "./types"

const BOGUS_MODEL_PATH = "/nonexistent/domia-eval-bogus-model"
const BOGUS_BASE_URL = "http://127.0.0.1:9/v1"
const EXTERNAL_STT_ENGINES = ["NEMO_SPEECH", "OPENAI_COMPATIBLE"]
const CHAT_SLOWDOWN_FACTOR = 3
const CHAT_SLOWDOWN_MARGIN_MS = 4000

const checker = makeChecker()

const getConfig = async (): Promise<Record<string, unknown>> => {
	const res = await fetch(
		`${env.EVAL_URL}/config?domiaKey=${env.EVAL_DOMIA_KEY}`,
		{ headers: meshHeaders() },
	)
	if (!res.ok) throw new Error(`GET /config ${res.status}`)
	const body = (await res.json()) as { config?: Record<string, unknown> }
	return body.config ?? {}
}

const postConfig = async (bundle: unknown): Promise<ApplyResponseType> => {
	const res = await fetch(
		`${env.EVAL_URL}/config?domiaKey=${env.EVAL_DOMIA_KEY}`,
		{
			method: "POST",
			headers: { "content-type": "application/json", ...meshHeaders() },
			body: JSON.stringify(bundle),
		},
	)
	return (await res.json()) as ApplyResponseType
}

const sectionOf = (
	config: Record<string, unknown>,
	section: string,
): Record<string, unknown> =>
	(config[section] as Record<string, unknown> | undefined) ?? {}

const timedChat = async (
	text: string,
): Promise<{ reply: string; ms: number }> => {
	const started = Date.now()
	const { reply } = await postChat(text)
	return { reply, ms: Date.now() - started }
}

const probeCases = (
	config: Record<string, unknown>,
): ConfigApplyProbeCaseType[] => {
	const stt = sectionOf(config, "stt")
	const sttExternal = EXTERNAL_STT_ENGINES.includes(String(stt.engine))
	return [
		{
			label: "bogus tts.modelPath",
			section: "tts",
			subsystem: "tts-pool",
			patch: { modelPath: BOGUS_MODEL_PATH },
		},
		{
			label: sttExternal ? "bogus stt.baseUrl" : "bogus stt.modelPath",
			section: "stt",
			subsystem: "stt-pool",
			patch: sttExternal
				? { baseUrl: BOGUS_BASE_URL }
				: { modelPath: BOGUS_MODEL_PATH },
		},
		{
			label: "bogus llm.baseUrl",
			section: "llm",
			subsystem: "llm",
			patch: { baseUrl: BOGUS_BASE_URL },
		},
	]
}

const runProbeCase = async (
	probe: ConfigApplyProbeCaseType,
	baseline: Record<string, unknown>,
): Promise<void> => {
	const before = JSON.stringify(sectionOf(baseline, probe.section))
	const applied = await postConfig({ [probe.section]: probe.patch })
	const outcome = applied.apply?.subsystems.find(
		(s) => s.subsystem === probe.subsystem,
	)
	checker.check(
		`${probe.label} → result=reverted`,
		applied.apply?.result === "reverted",
		`result=${applied.apply?.result ?? "missing"} subsystems=${(
			applied.apply?.subsystems ?? []
		)
			.map((s) => `${s.subsystem}:${s.status}`)
			.join(",")}`,
	)
	checker.check(
		`${probe.label} → ${probe.subsystem} reports the failure it reverted`,
		outcome?.status === "reverted" && (outcome.error?.length ?? 0) > 0,
		`${outcome?.status ?? "missing"}:${outcome?.error ?? ""}`,
	)
	checker.check(
		`${probe.label} → reverted section is ${probe.section}`,
		applied.apply?.revertedSections.includes(probe.section) === true,
		(applied.apply?.revertedSections ?? []).join(","),
	)
	checker.check(
		`${probe.label} → never asks for a restart`,
		applied.apply?.result !== "restart",
		String(applied.apply?.result),
	)
	const after = JSON.stringify(sectionOf(await getConfig(), probe.section))
	checker.check(
		`${probe.label} → the ${probe.section} row is byte-identical after the revert`,
		after === before,
		after === before ? "identical" : `before=${before}\nafter=${after}`,
	)
}

const restoreBundle = (
	probes: ConfigApplyProbeCaseType[],
	baseline: Record<string, unknown>,
): Record<string, Record<string, unknown>> => {
	const bundle: Record<string, Record<string, unknown>> = {}
	for (const probe of probes) {
		const original = sectionOf(baseline, probe.section)
		bundle[probe.section] = {
			...bundle[probe.section],
			...Object.fromEntries(
				Object.keys(probe.patch).map((field) => [field, original[field]]),
			),
		}
	}
	return bundle
}

const restoreBaseline = async (
	probes: ConfigApplyProbeCaseType[],
	baseline: Record<string, unknown>,
): Promise<void> => {
	const restored = await postConfig(restoreBundle(probes, baseline))
	checker.check(
		"restoring the original values needs no reload",
		restored.apply?.result === "live" || restored.apply?.result === "reloaded",
		String(restored.apply?.result),
	)
	const final = await getConfig()
	for (const probe of probes)
		checker.check(
			`${probe.section} ends byte-identical to the baseline`,
			JSON.stringify(sectionOf(final, probe.section)) ===
				JSON.stringify(sectionOf(baseline, probe.section)),
			JSON.stringify(sectionOf(final, probe.section)),
		)
}

const main = async (): Promise<void> => {
	if (!(await waitForHealth(60_000))) {
		console.error(`❌ no node answers at ${env.EVAL_URL}`)
		process.exit(2)
	}
	const baseline = await getConfig()
	const warm = await timedChat("Tell me a one-line joke")
	checker.check(
		"the node answers a chat turn before the probes",
		warm.reply.trim().length > 0,
		`${warm.ms}ms`,
	)

	const probes = probeCases(baseline)
	try {
		for (const probe of probes) {
			console.log(`\n[${probe.label}]`)
			await runProbeCase(probe, baseline)
		}

		const after = await timedChat("Tell me a one-line joke")
		checker.check(
			"the node still answers after three reverted applies",
			after.reply.trim().length > 0,
			`${after.ms}ms`,
		)
		checker.check(
			"the answer comes from a live engine, not a cold restart",
			after.ms <= warm.ms * CHAT_SLOWDOWN_FACTOR + CHAT_SLOWDOWN_MARGIN_MS,
			`warm=${warm.ms}ms after=${after.ms}ms`,
		)
	} finally {
		await restoreBaseline(probes, baseline)
	}

	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} config-apply-live checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
