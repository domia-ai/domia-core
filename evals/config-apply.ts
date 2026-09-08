import { getTableColumns } from "drizzle-orm"

import {
	domia,
	moduleSettings,
	sttConfig,
	ttsConfig,
	llmModelConfig,
	wakeWordConfig,
} from "@/db/schema"
import type { SelectSkillProviderType } from "@/db"
import {
	CONFIG_SECTION_META_FIELDS,
	CONFIG_SECTION_PROPS,
	DOMIA_LIVE_FIELDS,
	DOMIA_UNTRACKED_FIELDS,
	STT_LIVE_FIELDS,
	STT_POOL_FIELDS,
	TTS_LIVE_FIELDS,
	TTS_POOL_FIELDS,
	LLM_DRAIN_FIELDS,
	LLM_LIVE_FIELDS,
	MODULES_SKILLS_FIELDS,
	MODULES_PROACTIVITY_FIELDS,
	MODULES_LIVE_FIELDS,
	WAKE_WORD_LISTENER_FIELDS,
	WAKE_WORD_LIVE_FIELDS,
} from "@/modules/config-apply/constants"

import {
	createApplyState,
	createConfigApplyEngine,
	createReloadRunner,
} from "@/modules/config-apply/utils"
import type {
	ConfigApplyOutcomeType,
	ConfigApplyStateType,
	ConfigReloaderType,
	ReloadSubsystemType,
} from "@/modules/config-apply/types"
import { serializeConfig } from "@/modules/config"
import type { ConfigSnapshotType } from "@/modules/config"
import type { DomiaType } from "@/modules/core"
import { getDomia } from "@/test-utils/factories"
import { createFailingOnceReloader } from "@/test-utils/mocks"
import type { StubReloaderType } from "@/test-utils/types"

import { makeChecker } from "./lib/assert"
import { configSchema } from "@/modules/http-api"
import { CONFIG_SCHEMA_HIDDEN_COLUMNS } from "@/modules/http-api/constants"

type SectionSpecType = {
	section: string
	columns: string[]
	buckets: { name: string; fields: readonly string[] }[]
}

type ApplyHarnessType = {
	current: () => DomiaType
	register: (
		subsystem: ReloadSubsystemType,
		reloader: ConfigReloaderType,
	) => void
	apply: (input: unknown) => Promise<ConfigApplyOutcomeType>
	snapshot: () => ConfigApplyStateType
	restarts: () => number
}

const meta = new Set<string>(CONFIG_SECTION_META_FIELDS)

const columnsOf = (table: Parameters<typeof getTableColumns>[0]): string[] =>
	Object.keys(getTableColumns(table))

const sections: SectionSpecType[] = [
	{
		section: "domia",
		columns: columnsOf(domia),
		buckets: [
			{ name: "live", fields: DOMIA_LIVE_FIELDS },
			{ name: "untracked", fields: DOMIA_UNTRACKED_FIELDS },
		],
	},
	{
		section: "modules",
		columns: columnsOf(moduleSettings).filter((c) => !meta.has(c)),
		buckets: [
			{ name: "skills", fields: MODULES_SKILLS_FIELDS },
			{ name: "proactivity", fields: MODULES_PROACTIVITY_FIELDS },
			{ name: "live", fields: MODULES_LIVE_FIELDS },
		],
	},
	{
		section: "stt",
		columns: columnsOf(sttConfig).filter((c) => !meta.has(c)),
		buckets: [
			{ name: "live", fields: STT_LIVE_FIELDS },
			{ name: "stt-pool", fields: STT_POOL_FIELDS },
		],
	},
	{
		section: "tts",
		columns: columnsOf(ttsConfig).filter((c) => !meta.has(c)),
		buckets: [
			{ name: "live", fields: TTS_LIVE_FIELDS },
			{ name: "tts-pool", fields: TTS_POOL_FIELDS },
		],
	},
	{
		section: "llm",
		columns: columnsOf(llmModelConfig).filter((c) => !meta.has(c)),
		buckets: [
			{ name: "live-drain", fields: LLM_DRAIN_FIELDS },
			{ name: "live", fields: LLM_LIVE_FIELDS },
		],
	},
	{
		section: "wakeWord",
		columns: columnsOf(wakeWordConfig).filter((c) => !meta.has(c)),
		buckets: [
			{ name: "voice-listener", fields: WAKE_WORD_LISTENER_FIELDS },
			{ name: "live", fields: WAKE_WORD_LIVE_FIELDS },
		],
	},
]

const PROP_BY_SECTION = new Map(
	CONFIG_SECTION_PROPS.map(({ section, prop }) => [section, prop]),
)

const EVAL_DOMIA_KEY = "CONFIG_APPLY_EVAL"

const makeHarness = (): ApplyHarnessType => {
	let current = getDomia({
		domiaOverrides: {
			domiaKey: EVAL_DOMIA_KEY,
			configRevision: 1,
			configReloadDrainMs: 0,
		},
	})
	let restarts = 0
	const reloaders = new Map<ReloadSubsystemType, ConfigReloaderType>()
	const state = createApplyState()

	const patchSection = (
		target: Record<string, unknown>,
		section: string,
		patch: Record<string, unknown>,
	): void => {
		const prop = PROP_BY_SECTION.get(section)
		if (!prop) return
		const row = target[prop]
		if (!row || typeof row !== "object") return
		target[prop] = { ...(row as Record<string, unknown>), ...patch }
	}

	const persist = (
		_domia: DomiaType,
		input: unknown,
	): Promise<{ config: ConfigSnapshotType }> => {
		const bundle = (input ?? {}) as Record<string, unknown>
		const next = { ...current }
		const rows = next as unknown as Record<string, unknown>
		for (const [section, patch] of Object.entries(bundle)) {
			if (section === "skillProviders") {
				next.skillProviders = patch as SelectSkillProviderType[]
				continue
			}
			if (patch && typeof patch === "object")
				patchSection(rows, section, patch as Record<string, unknown>)
		}
		next.configRevision = current.configRevision + 1
		current = next
		return Promise.resolve({ config: serializeConfig(current) })
	}

	const engine = createConfigApplyEngine({
		state,
		runner: createReloadRunner({
			state,
			hostedIds: () => Promise.resolve([current.id]),
			resolveLatest: () => Promise.resolve(current),
			quiesce: () => Promise.resolve(),
			runExclusive: (_key, fn) => fn(),
		}),
		reloaderFor: (subsystem) => reloaders.get(subsystem),
		persist,
		resolve: () => Promise.resolve(current),
		quiesce: () => Promise.resolve(),
		runExclusive: (_key, fn) => fn(),
		onLlmClientStale: () => undefined,
		requestRestart: () => {
			restarts += 1
		},
		defaultDrainMs: 0,
	})

	return {
		current: () => current,
		register: (subsystem, reloader) => reloaders.set(subsystem, reloader),
		apply: (input) => engine.applyConfig(current, input),
		snapshot: () => state.snapshot(EVAL_DOMIA_KEY),
		restarts: () => restarts,
	}
}

const subsystemOutcome = (outcome: ConfigApplyOutcomeType, subsystem: string) =>
	outcome.apply.subsystems.find((s) => s.subsystem === subsystem)

const checkFailedReloadReverts = async (
	checker: ReturnType<typeof makeChecker>,
): Promise<void> => {
	const harness = makeHarness()
	const stub: StubReloaderType = createFailingOnceReloader({ scope: "global" })
	harness.register("tts-pool", stub)
	const previousEngine = harness.current().ttsConfig?.engine

	const first = await harness.apply({
		tts: { engine: "EVAL_BOGUS_ENGINE", speed: 1.25 },
	})
	const outcome = subsystemOutcome(first, "tts-pool")

	checker.check(
		"failed reload reports result=reverted",
		first.apply.result === "reverted",
		first.apply.result,
	)
	checker.check(
		"failed reload reports the section it reverted",
		first.apply.revertedSections.includes("tts"),
		first.apply.revertedSections.join(","),
	)
	checker.check(
		"failed subsystem reports status=reverted with its error",
		outcome?.status === "reverted" && (outcome.error?.length ?? 0) > 0,
		`${outcome?.status ?? "missing"}:${outcome?.error ?? ""}`,
	)
	checker.check(
		"reverted section is rolled back in the store",
		harness.current().ttsConfig?.engine === previousEngine,
		String(harness.current().ttsConfig?.engine),
	)
	checker.check(
		"fields that reloaded fine stay applied",
		harness.current().ttsConfig?.speed === 1.25,
		String(harness.current().ttsConfig?.speed),
	)
	checker.check(
		"a reverted subsystem is back in sync",
		harness.snapshot().subsystems.find((s) => s.subsystem === "tts-pool")
			?.inSync === true,
	)

	const second = await harness.apply({})
	checker.check(
		"a reverted subsystem is not reconciled again",
		second.apply.reconciled.length === 0 && stub.calls() === 1,
		`reconciled=${second.apply.reconciled.join(",")} calls=${stub.calls()}`,
	)
}

const checkUnrevertableFailureReconciles = async (
	checker: ReturnType<typeof makeChecker>,
): Promise<void> => {
	const harness = makeHarness()
	const stub: StubReloaderType = createFailingOnceReloader({
		scope: "per-identity",
	})
	harness.register("skills", stub)

	const first = await harness.apply({
		skillProviders: [{ id: "eval-provider", name: "eval" }],
	})
	const failed = subsystemOutcome(first, "skills")
	const pendingState = harness
		.snapshot()
		.subsystems.find((s) => s.subsystem === "skills")

	checker.check(
		"an unrevertable failure reports result=partial",
		first.apply.result === "partial",
		first.apply.result,
	)
	checker.check(
		"an unrevertable failure reports status=failed with its error",
		failed?.status === "failed" && (failed.error?.length ?? 0) > 0,
		`${failed?.status ?? "missing"}:${failed?.error ?? ""}`,
	)
	checker.check(
		"nothing is reverted when the previous value is unknown",
		first.apply.revertedSections.length === 0,
		first.apply.revertedSections.join(","),
	)
	checker.check(
		"a failed subsystem stays behind the desired revision",
		pendingState?.inSync === false &&
			pendingState.runningRevision < pendingState.desiredRevision &&
			(pendingState.lastError?.length ?? 0) > 0,
		JSON.stringify(pendingState),
	)

	const second = await harness.apply({})
	const healed = subsystemOutcome(second, "skills")
	const healedState = harness
		.snapshot()
		.subsystems.find((s) => s.subsystem === "skills")

	checker.check(
		"the next apply reconciles the lagging subsystem",
		second.apply.reconciled.includes("skills"),
		second.apply.reconciled.join(","),
	)
	checker.check(
		"the reconciled subsystem reloads and catches up",
		healed?.status === "reloaded" &&
			healedState?.inSync === true &&
			healedState.lastError === null,
		`${healed?.status ?? "missing"} ${JSON.stringify(healedState)}`,
	)
	checker.check(
		"reconciliation re-runs the reloader exactly once",
		stub.calls() === 2 && stub.failures() === 1,
		`calls=${stub.calls()} failures=${stub.failures()}`,
	)
	checker.check(
		"a recoverable reload never asks for a restart",
		harness.restarts() === 0,
		String(harness.restarts()),
	)
}

const main = async (): Promise<void> => {
	const checker = makeChecker()
	for (const { section, columns, buckets } of sections) {
		console.log(`\n[${section}] ${columns.length} schema columns`)
		const classified = new Map<string, string[]>()
		for (const bucket of buckets)
			for (const field of bucket.fields)
				classified.set(field, [...(classified.get(field) ?? []), bucket.name])
		const unclassified = columns.filter((c) => !classified.has(c))
		checker.check(
			"every schema column has a classification",
			unclassified.length === 0,
			`unclassified=${unclassified.join(",")}`,
		)
		const columnSet = new Set(columns)
		const stale = [...classified.keys()].filter((f) => !columnSet.has(f))
		checker.check(
			"no classified field is missing from the schema",
			stale.length === 0,
			`stale=${stale.join(",")}`,
		)
		const overlapping = [...classified.entries()]
			.filter(([, names]) => names.length > 1)
			.map(([field, names]) => `${field}:${names.join("+")}`)
		checker.check(
			"each column lands in exactly one bucket",
			overlapping.length === 0,
			`overlapping=${overlapping.join(",")}`,
		)
		for (const bucket of buckets)
			console.log(`  ${bucket.name}: ${bucket.fields.length}`)
	}
	const schema = configSchema()
	const schemaFields = new Map(
		schema.sections.map((sec) => [
			sec.id,
			new Set(sec.fields.map((f) => f.key)),
		]),
	)
	for (const spec of sections) {
		const exposed = schemaFields.get(spec.section) ?? new Set<string>()
		const missing = spec.columns.filter(
			(c) =>
				!meta.has(c) && !CONFIG_SCHEMA_HIDDEN_COLUMNS.has(c) && !exposed.has(c),
		)
		checker.check(
			`config schema exposes every ${spec.section} column`,
			missing.length === 0,
			missing.join(","),
		)
	}
	const secrets = schema.sections.flatMap((sec) =>
		sec.fields.filter((f) => f.secret).map((f) => `${sec.id}.${f.key}`),
	)
	checker.check(
		"config schema marks credentials as secret",
		secrets.includes("mqttLocal.password") && secrets.includes("llm.apiKey"),
		secrets.join(","),
	)
	checker.check(
		"config schema never exposes ids or timestamps",
		schema.sections.every((sec) =>
			sec.fields.every(
				(f) => !["id", "domiaId", "createdAt", "updatedAt"].includes(f.key),
			),
		),
	)
	checker.check(
		"config schema enums carry their values",
		(schema.sections
			.find((sec) => sec.id === "tts")
			?.fields.find((f) => f.key === "engine")?.enumValues?.length ?? 0) >= 6,
	)

	console.log("\n[runtime] failed reload revert + reconciliation")
	await checkFailedReloadReverts(checker)
	await checkUnrevertableFailureReconciles(checker)

	console.log(
		`\nconfig-apply classification: ${checker.passCount()} passed, ${checker.failCount()} failed`,
	)
	if (checker.failCount() > 0) process.exit(1)
}

void main()
