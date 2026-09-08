import {
	DEFAULT_REFLECTION_CONCURRENCY,
	DEFAULT_REFLECTION_IDLE_GRACE_MS,
	DEFAULT_REFLECTION_IDLE_POLL_MS,
	DEFAULT_REFLECTION_MAX_IDLE_WAIT_MS,
	DEFAULT_REFLECTION_ONLY_WHEN_IDLE,
	DEFAULT_REFLECTION_QUEUE_MAX_DEPTH,
	DEFAULT_REFLECTION_SLOT_TIMEOUT_MS,
	DEFAULT_REFLECTION_TIMEOUT_MS,
	DEFAULT_REFLECTION_YIELD_MAX_ATTEMPTS,
	DEFAULT_REFLECTION_YIELD_TO_VOICE,
} from "@/db/constants"
import { createReflectionGate } from "@/modules/reflection/utils"
import type { ReflectionGateSettingsType } from "@/modules/reflection/types"
import { createLogger } from "@/utils/logger"

import { makeChecker } from "./lib/assert"
import type { ReflectionGateScenarioType, VirtualClockType } from "./types"

const REPLY_MS = 6_000
const TURN_GAP_MS = 2_000
const CONVERSATION_MS = 30_000

const defaultSettings = (): ReflectionGateSettingsType => ({
	onlyWhenIdle: DEFAULT_REFLECTION_ONLY_WHEN_IDLE,
	concurrency: DEFAULT_REFLECTION_CONCURRENCY,
	queueMaxDepth: DEFAULT_REFLECTION_QUEUE_MAX_DEPTH,
	yieldToVoice: DEFAULT_REFLECTION_YIELD_TO_VOICE,
	timeoutMs: DEFAULT_REFLECTION_TIMEOUT_MS,
	idlePollMs: DEFAULT_REFLECTION_IDLE_POLL_MS,
	idleGraceMs: DEFAULT_REFLECTION_IDLE_GRACE_MS,
	maxIdleWaitMs: DEFAULT_REFLECTION_MAX_IDLE_WAIT_MS,
	slotTimeoutMs: DEFAULT_REFLECTION_SLOT_TIMEOUT_MS,
	yieldMaxAttempts: DEFAULT_REFLECTION_YIELD_MAX_ATTEMPTS,
})

const createVirtualClock = (): VirtualClockType => {
	let now = 0
	return {
		now: () => now,
		sleep: (ms) => {
			now += ms
			return Promise.resolve()
		},
		elapsed: () => now,
	}
}

const nonstopConversation = (t: number): boolean =>
	t % (REPLY_MS + TURN_GAP_MS) < REPLY_MS

const conversationThenPause = (t: number): boolean =>
	t < CONVERSATION_MS && nonstopConversation(t)

const revalidationSpikes = (settings: ReflectionGateSettingsType): number[] => {
	const spikes: number[] = []
	let instant = settings.idleGraceMs
	for (let i = 0; i < 3; i++) {
		spikes.push(instant)
		instant += settings.idlePollMs + settings.idleGraceMs
	}
	return spikes
}

const scenarios: ReflectionGateScenarioType[] = [
	{
		name: "nonstop turns (gap < grace) starve reflection but stay bounded by maxIdleWait",
		busyAt: nonstopConversation,
		expectRan: false,
		minElapsedMs: DEFAULT_REFLECTION_MAX_IDLE_WAIT_MS,
		maxElapsedMs:
			DEFAULT_REFLECTION_MAX_IDLE_WAIT_MS + DEFAULT_REFLECTION_IDLE_POLL_MS * 2,
	},
	{
		name: "conversation then a real pause: reflection runs after grace, within maxIdleWait",
		busyAt: conversationThenPause,
		expectRan: true,
		minElapsedMs: CONVERSATION_MS + DEFAULT_REFLECTION_IDLE_GRACE_MS,
		maxElapsedMs:
			CONVERSATION_MS +
			DEFAULT_REFLECTION_IDLE_GRACE_MS +
			DEFAULT_REFLECTION_IDLE_POLL_MS * 2,
	},
	{
		name: "regression pin: maxIdleWait below the turn cadence starves every capture",
		busyAt: conversationThenPause,
		settingsPatch: { maxIdleWaitMs: 10_000 },
		expectRan: false,
		minElapsedMs: 10_000,
		maxElapsedMs: 10_000 + DEFAULT_REFLECTION_IDLE_POLL_MS * 2,
	},
	{
		name: "onlyWhenIdle=false runs immediately even mid-conversation",
		busyAt: nonstopConversation,
		settingsPatch: { onlyWhenIdle: false },
		expectRan: true,
		minElapsedMs: 0,
		maxElapsedMs: 0,
	},
]

const runScenario = async (
	scenario: ReflectionGateScenarioType,
	checker: ReturnType<typeof makeChecker>,
): Promise<void> => {
	const clock = createVirtualClock()
	const settings = { ...defaultSettings(), ...scenario.settingsPatch }
	const gate = createReflectionGate({
		activeVoiceReplies: () => (scenario.busyAt(clock.now()) ? 1 : 0),
		sleep: clock.sleep,
		now: clock.now,
		logger: createLogger("evals:reflection"),
	})
	const calls: string[] = []
	const result = await gate.runGated(
		"identity-a",
		settings,
		() => {
			calls.push("reflected")
			return Promise.resolve("reflected")
		},
		"skipped",
	)
	const ran = calls.length > 0
	const elapsed = clock.elapsed()
	console.log(`\n[${scenario.name}]`)
	checker.check(
		`ran=${scenario.expectRan}`,
		ran === scenario.expectRan && result === (ran ? "reflected" : "skipped"),
		`ran=${ran} result=${result}`,
	)
	checker.check(
		`elapsed within [${scenario.minElapsedMs}, ${scenario.maxElapsedMs}] ms`,
		elapsed >= scenario.minElapsedMs && elapsed <= scenario.maxElapsedMs,
		`elapsed=${elapsed}`,
	)
}

const runRevalidationYield = async (
	checker: ReturnType<typeof makeChecker>,
): Promise<void> => {
	const clock = createVirtualClock()
	const settings = defaultSettings()
	const spikes = new Set(revalidationSpikes(settings))
	const gate = createReflectionGate({
		activeVoiceReplies: () => (spikes.has(clock.now()) ? 1 : 0),
		sleep: clock.sleep,
		now: clock.now,
		logger: createLogger("evals:reflection"),
	})
	const calls: string[] = []
	const result = await gate.runGated(
		"identity-a",
		settings,
		() => {
			calls.push("reflected")
			return Promise.resolve("reflected")
		},
		"skipped",
	)
	const ran = calls.length > 0
	const lastSpike = Math.max(...spikes)
	console.log("\n[voice returns exactly at slot revalidation, three times]")
	checker.check(
		"gate yields the slot and skips after the revalidation budget",
		!ran && result === "skipped",
		`ran=${ran} result=${result}`,
	)
	checker.check(
		"each yield re-waits a full grace window before retrying",
		clock.elapsed() === lastSpike,
		`elapsed=${clock.elapsed()} expected=${lastSpike}`,
	)
}

const runBacklog = async (
	checker: ReturnType<typeof makeChecker>,
): Promise<void> => {
	const clock = createVirtualClock()
	const settings = {
		...defaultSettings(),
		onlyWhenIdle: false,
		concurrency: 1,
		queueMaxDepth: 1,
	}
	const gate = createReflectionGate({
		activeVoiceReplies: () => 0,
		sleep: clock.sleep,
		now: clock.now,
		logger: createLogger("evals:reflection"),
	})
	const releasers: (() => void)[] = []
	const firstStarted = new Promise<void>((markStarted) => {
		releasers.push(markStarted)
	})
	const first = gate.runGated(
		"identity-a",
		settings,
		() =>
			new Promise<string>((resolve) => {
				releasers.push(() => resolve("first"))
				releasers[0]?.()
			}),
		"skipped",
	)
	const second = gate.runGated(
		"identity-a",
		settings,
		() => Promise.resolve("second"),
		"skipped",
	)
	const third = await gate.runGated(
		"identity-a",
		settings,
		() => Promise.resolve("third"),
		"skipped",
	)
	console.log("\n[backlog: concurrency=1, queue=1]")
	checker.check(
		"third reflection is dropped while two are pending",
		third === "skipped",
		`third=${third}`,
	)
	await firstStarted
	releasers[1]?.()
	const [firstResult, secondResult] = await Promise.all([first, second])
	checker.check(
		"queued reflection runs once the slot frees",
		firstResult === "first" && secondResult === "second",
		`first=${firstResult} second=${secondResult}`,
	)
	const fourth = await gate.runGated(
		"identity-a",
		settings,
		() => Promise.resolve("fourth"),
		"skipped",
	)
	checker.check(
		"backlog counter drains after completion",
		fourth === "fourth",
		`fourth=${fourth}`,
	)
}

const main = async (): Promise<void> => {
	const checker = makeChecker()
	for (const scenario of scenarios) await runScenario(scenario, checker)
	await runRevalidationYield(checker)
	await runBacklog(checker)
	console.log(
		`\nreflection gate: ${checker.passCount()} passed, ${checker.failCount()} failed`,
	)
	if (checker.failCount() > 0) process.exit(1)
}

void main()
