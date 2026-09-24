import { randomUUID } from "crypto"

import {
	BUILTIN_PROVIDER_ID_PREFIX,
	BUILTIN_PROVIDER_NAME,
	BUILTIN_PROVIDER_URL,
	SKILL_PROTOCOL_ENUM,
	SKILL_TOOL_NAME_SEPARATOR,
	SKILL_TRUST_TIER_ENUM,
	MCP_TRANSPORT_ENUM,
	type SelectSkillProviderType,
	type SkillToolType,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import { matchFastPath, invalidateFastPathIndex } from "@/modules/fast-path"
import {
	callTool,
	connectProvider,
	disconnectProviders,
	getConnectionsFor,
	getToolPolicy,
	setSkillRuntimePort,
	type OriginCapabilitiesType,
	type SkillRuntimePortType,
	type SkillRuntimeTimerType,
} from "@/modules/skill-engine"
import { DOMIA_TOOLS } from "@/modules/skill-engine/specializations/domia/tools"
import { languageSetsFor, runWithTraceContext } from "@/utils"
import { baseLlmModelConfig, baseSkillProvider } from "@/test-utils/mocks"

import { makeChecker } from "./lib"

const checker = makeChecker()
const SLUG = BUILTIN_PROVIDER_NAME
const LANGUAGES = ["en", "es"] as const
const LAST_REPLY = "The kitchen lights are on."
const SATELLITE_NAME = "Kitchen speaker"

const namespaced = (tool: string): string =>
	`${SLUG}${SKILL_TOOL_NAME_SEPARATOR}${tool}`

const toolsCache = (): SkillToolType[] =>
	DOMIA_TOOLS.map((tool) => ({
		provider: SLUG,
		rawName: tool.name,
		namespacedName: namespaced(tool.name),
		description: tool.definition.description,
		inputSchema: tool.definition.inputSchema ?? {
			type: "object",
			properties: {},
		},
		...(tool.definition.annotations
			? { annotations: tool.definition.annotations }
			: {}),
	}))

const domiaFor = (id: string, language: string): DomiaType =>
	({
		id,
		domiaKey: `BUILTIN_EVAL_${language.toUpperCase()}`,
		characterProfile: { name: "Domia", language },
		llmModelConfig: { ...baseLlmModelConfig(id), fastPathEnabled: false },
		moduleSettings: null,
		runtimeCapabilities: null,
	}) as unknown as DomiaType

const providerFor = (domiaId: string): SelectSkillProviderType => ({
	...baseSkillProvider(domiaId),
	id: `${BUILTIN_PROVIDER_ID_PREFIX}${domiaId}`,
	name: BUILTIN_PROVIDER_NAME,
	protocol: SKILL_PROTOCOL_ENUM.BUILTIN,
	type: MCP_TRANSPORT_ENUM.HTTP,
	url: BUILTIN_PROVIDER_URL,
	trustTier: SKILL_TRUST_TIER_ENUM.TRUSTED,
	descriptor: { version: 1, kind: BUILTIN_PROVIDER_NAME },
	toolsCache: toolsCache(),
	priority: 0,
})

const satelliteOrigin: OriginCapabilitiesType = {
	source: "satellite",
	satelliteId: "sat-1",
	satelliteProtocol: "esphome",
	connected: true,
	canSpeak: true,
	canAnnounce: true,
	canFollowUp: true,
	canConfirm: true,
	timerNative: true,
	volumeNative: true,
	localPlayback: false,
}

const chatOrigin: OriginCapabilitiesType = {
	source: "http",
	satelliteId: null,
	satelliteProtocol: null,
	connected: true,
	canSpeak: false,
	canAnnounce: false,
	canFollowUp: false,
	canConfirm: true,
	timerNative: false,
	volumeNative: false,
	localPlayback: false,
}

const fake = {
	domias: new Map<string, DomiaType>(),
	connectedSatellite: null as string | null,
	rows: [] as (SkillRuntimeTimerType & {
		cancelled: boolean
		repeatDailyAt: string | null
		templateParams: Record<string, string>
	})[],
	wakes: [] as number[],
	mirrored: [] as string[],
	volumes: new Map<string, number>(),
	facts: [] as { subject: string; relation: string; value: string }[],
	expired: [] as string[],
	reflectionClaims: [] as string[],
}

const ALLOWED_RELATION_RE = /^(is|has|likes?|lives?)\b/
const LOCAL_VOLUME_KEY = "local"
const SATELLITE_VOLUME_KEY = "sat-1"

const announce = (
	origin: OriginCapabilitiesType,
): ReturnType<SkillRuntimePortType["announceTarget"]> =>
	origin.satelliteId
		? { kind: "satellite", satelliteId: origin.satelliteId }
		: fake.connectedSatellite
			? { kind: "satellite", satelliteId: fake.connectedSatellite }
			: origin.localPlayback
				? { kind: "local" }
				: { kind: "none" }

const visibleFrom = (
	row: SkillRuntimeTimerType,
	origin: OriginCapabilitiesType,
): boolean =>
	origin.satelliteId
		? row.targetSatelliteId === origin.satelliteId ||
			row.targetKind !== "satellite"
		: true

const activeRows = (
	origin: OriginCapabilitiesType,
	kind: SkillRuntimeTimerType["kind"],
) =>
	fake.rows
		.filter((r) => !r.cancelled && r.kind === kind && visibleFrom(r, origin))
		.sort((a, b) => a.dueAt.localeCompare(b.dueAt))

const fakePort: SkillRuntimePortType = {
	domiaOf: (domiaId) => Promise.resolve(fake.domias.get(domiaId) ?? null),
	originCapabilities: (_domia, satelliteId) =>
		satelliteId ? satelliteOrigin : chatOrigin,
	announceTarget: (_domiaId, origin) => announce(origin),
	timers: {
		start: ({
			origin,
			seconds,
			label,
			kind,
			text,
			dueAt,
			repeatDailyAt,
			templateParams,
		}) => {
			const destination = announce(origin)
			if (destination.kind === "none")
				return Promise.reject(new Error("no announce target"))
			const timer = {
				id: randomUUID(),
				kind,
				label,
				text: text ?? null,
				dueAt: dueAt ?? new Date(Date.now() + seconds * 1000).toISOString(),
				remainingSeconds: seconds,
				totalSeconds: seconds,
				targetKind: destination.kind,
				targetSatelliteId:
					destination.kind === "satellite" ? destination.satelliteId : null,
				cancelled: false,
				repeatDailyAt: repeatDailyAt ?? null,
				templateParams: templateParams ?? {},
			}
			fake.rows.push(timer)
			fake.wakes.push(Date.parse(timer.dueAt))
			if (origin.timerNative) fake.mirrored.push("started")
			return Promise.resolve({
				timer,
				destination,
				destinationName:
					destination.kind === "satellite" ? SATELLITE_NAME : null,
			})
		},
		cancel: (_domia, origin, kind) => {
			const rows = activeRows(origin, kind)
			for (const r of rows) r.cancelled = true
			return Promise.resolve(rows)
		},
		list: (_domia, origin, kind) => Promise.resolve(activeRows(origin, kind)),
		remaining: (timer) =>
			Math.max(0, Math.round((Date.parse(timer.dueAt) - Date.now()) / 1000)),
	},
	schedule: {
		create: () => Promise.reject(new Error("not used by wave 1 tools")),
		cancel: () => Promise.resolve(null),
		list: () => Promise.resolve([]),
		wakeAt: (_domia, atMs) => {
			fake.wakes.push(atMs)
		},
	},
	lastReply: () => Promise.resolve(LAST_REPLY),
	volume: {
		get: (_domia, origin) =>
			Promise.resolve(
				origin.satelliteId
					? origin.volumeNative
						? (fake.volumes.get(SATELLITE_VOLUME_KEY) ?? null)
						: null
					: origin.localPlayback
						? (fake.volumes.get(LOCAL_VOLUME_KEY) ?? 100)
						: null,
			),
		set: (_domia, origin, level) => {
			if (origin.satelliteId && !origin.volumeNative)
				return Promise.resolve(null)
			if (!origin.satelliteId && !origin.localPlayback)
				return Promise.resolve(null)
			fake.volumes.set(
				origin.satelliteId ? SATELLITE_VOLUME_KEY : LOCAL_VOLUME_KEY,
				level,
			)
			return Promise.resolve(level)
		},
	},
	facts: {
		upsert: (_domia, { subject, relation, value }) => {
			if (subject !== "user" && subject !== "the user")
				return Promise.resolve({
					written: false,
					reason: "subject not the user",
				})
			if (!ALLOWED_RELATION_RE.test(relation))
				return Promise.resolve({
					written: false,
					reason: "relation not state-shaped",
				})
			fake.facts.push({ subject, relation, value })
			return Promise.resolve({ written: true, reason: null })
		},
		expire: (_domia, what) => {
			const needle = what.toLowerCase()
			const matching = fake.facts.filter((f) =>
				`${f.subject} ${f.relation} ${f.value}`.toLowerCase().includes(needle),
			)
			fake.facts = fake.facts.filter((f) => !matching.includes(f))
			fake.expired.push(...matching.map((f) => f.value))
			return Promise.resolve(matching.length)
		},
	},
	memory: {
		markReflectionCaptured: (interactionId) => {
			fake.reflectionClaims.push(interactionId)
		},
	},
}

const subsetMatches = (
	got: Record<string, unknown>,
	expected: Record<string, unknown> | undefined,
): boolean =>
	Object.entries(expected ?? {}).every(
		([key, value]) => JSON.stringify(got[key]) === JSON.stringify(value),
	)

const call = (
	domia: DomiaType,
	tool: string,
	args: Record<string, unknown> = {},
	satelliteId?: string,
) =>
	runWithTraceContext(
		{
			originDomiaKey: domia.domiaKey,
			...(satelliteId ? { satelliteId } : {}),
		},
		() => callTool(domia.id, namespaced(tool), args, undefined, true),
	)

const checkPacks = (domia: DomiaType, language: string): void => {
	console.log(
		`\n${language}: every pack sample reaches its tool through the fast path`,
	)
	for (const tool of DOMIA_TOOLS) {
		if (!(language in tool.packs)) continue
		for (const sample of tool.packs[language].samples ?? []) {
			const verdict = matchFastPath(domia, sample.text, satelliteOrigin)
			const ok =
				verdict.kind === "match" &&
				verdict.match.namespacedName === namespaced(tool.name) &&
				subsetMatches(verdict.match.resolvedArgs, sample.args)
			checker.check(
				`${language} "${sample.text}" → ${tool.name}${sample.args ? ` ${JSON.stringify(sample.args)}` : ""}`,
				ok,
				`got=${JSON.stringify(verdict)}`,
			)
		}
	}
}

const checkNegatives = (domia: DomiaType, language: string): void => {
	console.log(`\n${language}: chat sentences stay off the built-in fast path`)
	const negatives: Record<string, string[]> = {
		en: [
			"tell me a joke",
			"what's my favorite color",
			"don't turn on the lights",
			"what time does the store open",
			"what time is it in tokyo",
			"do you know what time it is in london",
			"set a timer for the time it takes",
			"turn off the lights",
			"could you possibly tell me the hour",
			"stop",
			"",
			"turn down the volume",
			"louder",
			"forget what I said about coffee",
			"remember that my sister is called Elena",
		],
		es: [
			"cuéntame un chiste",
			"a qué hora abre la tienda",
			"apaga las luces",
			"para",
			"baja el volumen",
			"sube el volumen de la cocina",
			"olvida lo que te dije del café",
		],
	}
	for (const text of negatives[language] ?? []) {
		const verdict = matchFastPath(domia, text, satelliteOrigin)
		checker.check(
			`${language} "${text || "<empty>"}" is left to the LLM`,
			verdict.kind === "miss",
			`got=${JSON.stringify(verdict)}`,
		)
	}
}

const checkRanking = (domia: DomiaType): void => {
	console.log("\nen: ranking between built-in intents")
	const forget = matchFastPath(domia, "forget it", satelliteOrigin)
	checker.check(
		'"forget it" ranks as cancel',
		forget.kind === "match" && forget.match.tool === "cancel",
		`got=${JSON.stringify(forget)}`,
	)
	const cancelTimer = matchFastPath(domia, "cancel the timer", satelliteOrigin)
	checker.check(
		'"cancel the timer" ranks as timer_cancel, not cancel',
		cancelTimer.kind === "match" && cancelTimer.match.tool === "timer_cancel",
		`got=${JSON.stringify(cancelTimer)}`,
	)
	const cancelReminder = matchFastPath(
		domia,
		"cancel my reminder",
		satelliteOrigin,
	)
	checker.check(
		'"cancel my reminder" carries action=cancel for reminder',
		cancelReminder.kind === "match" &&
			cancelReminder.match.tool === "reminder" &&
			cancelReminder.match.resolvedArgs.action === "cancel",
		`got=${JSON.stringify(cancelReminder)}`,
	)
}

const checkExecutors = async (domia: DomiaType): Promise<void> => {
	console.log("\nen: executors")
	const en = languageSetsFor("en")
	const before = new Date()
	const time = await call(domia, "time")
	const after = new Date()
	const expectedTimes = [before, after].map((d) => `It's ${en.spokenTime(d)}.`)
	checker.check(
		"time speaks the current time",
		time.status === "ok" && expectedTimes.includes(time.speakableText ?? ""),
		`got=${JSON.stringify(time)}`,
	)
	const date = await call(domia, "date")
	checker.check(
		"date speaks today's date",
		date.status === "ok" &&
			date.speakableText === `Today is ${en.spokenDate(new Date())}.`,
		`got=${JSON.stringify(date)}`,
	)
	const repeat = await call(domia, "repeat")
	checker.check(
		"repeat speaks the last reply verbatim",
		repeat.status === "ok" && repeat.speakableText === LAST_REPLY,
		`got=${JSON.stringify(repeat)}`,
	)
	const cancel = await call(domia, "cancel")
	checker.check(
		"cancel acknowledges and does nothing",
		cancel.status === "ok" && cancel.speakableText === "Okay.",
		`got=${JSON.stringify(cancel)}`,
	)
	const rejected = await call(domia, "timer", { seconds: 0 }, "sat-1")
	checker.check(
		"timer rejects out-of-range arguments",
		rejected.status === "error" && rejected.isError,
		`got=${JSON.stringify(rejected)}`,
	)
}

const checkTimers = async (domia: DomiaType): Promise<void> => {
	console.log("\nen: timer availability and destination")
	fake.connectedSatellite = null
	const unavailable = matchFastPath(
		domia,
		"set a timer for five minutes",
		chatOrigin,
	)
	checker.check(
		"a /chat origin without any announce target makes timer unavailable",
		unavailable.kind === "miss" && unavailable.reason === "unavailable",
		`got=${JSON.stringify(unavailable)}`,
	)
	const unrelated = matchFastPath(
		domia,
		"turn on the office lights",
		chatOrigin,
	)
	checker.check(
		"an unrelated phrase from that origin misses as no_match, not unavailable",
		unrelated.kind === "miss" && unrelated.reason === "no_match",
		`got=${JSON.stringify(unrelated)}`,
	)
	const refused = await call(domia, "timer", { seconds: 300 })
	checker.check(
		"the executor re-checks availability for HTTP callers",
		refused.status === "error" &&
			refused.speakableText === "I can't do that from this device.",
		`got=${JSON.stringify(refused)}`,
	)
	fake.connectedSatellite = "sat-2"
	const available = matchFastPath(
		domia,
		"set a timer for five minutes",
		chatOrigin,
	)
	checker.check(
		"a /chat origin with a connected satellite elsewhere matches timer",
		available.kind === "match" && available.match.resolvedArgs.seconds === 300,
		`got=${JSON.stringify(available)}`,
	)
	const created = await call(domia, "timer", { seconds: 300 })
	checker.check(
		"the reply names the destination when it differs from the origin",
		created.status === "ok" &&
			created.speakableText === `Timer set for 5 minutes on ${SATELLITE_NAME}.`,
		`got=${JSON.stringify(created)}`,
	)
	checker.check(
		"the schedule was woken for the due time",
		fake.wakes.length > 0,
		`wakes=${fake.wakes.length}`,
	)
	const fromSatellite = await call(
		domia,
		"timer",
		{ seconds: 90, label: "pasta" },
		"sat-1",
	)
	checker.check(
		"a satellite origin keeps its own timer and mirrors it",
		fromSatellite.status === "ok" &&
			fromSatellite.speakableText === "Timer set for pasta." &&
			fake.mirrored.includes("started"),
		`got=${JSON.stringify(fromSatellite)}`,
	)
	const status = await call(domia, "timer_status", {}, "sat-1")
	checker.check(
		"timer_status reports the remaining time of the soonest timer",
		status.status === "ok" &&
			(status.speakableText ?? "").endsWith("left on your pasta timer."),
		`got=${JSON.stringify(status)}`,
	)
	const cancelled = await call(domia, "timer_cancel", {}, "sat-1")
	checker.check(
		"timer_cancel cancels the running timers",
		cancelled.status === "ok" && cancelled.speakableText === "Timer cancelled.",
		`got=${JSON.stringify(cancelled)}`,
	)
	const none = await call(domia, "timer_cancel", {}, "sat-1")
	checker.check(
		"timer_cancel with nothing running says so",
		none.status === "ok" && none.speakableText === "There's no timer running.",
		`got=${JSON.stringify(none)}`,
	)
	const reminder = await call(
		domia,
		"reminder",
		{ text: "call mom", seconds: 1200 },
		"sat-1",
	)
	checker.check(
		"reminder is created from the LLM call",
		reminder.status === "ok" &&
			reminder.speakableText === "I'll remind you: call mom.",
		`got=${JSON.stringify(reminder)}`,
	)
	const reminderCancelled = await call(
		domia,
		"reminder",
		{ action: "cancel" },
		"sat-1",
	)
	checker.check(
		"reminder cancel clears pending reminders",
		reminderCancelled.status === "ok" &&
			reminderCancelled.speakableText === "Reminder cancelled.",
		`got=${JSON.stringify(reminderCancelled)}`,
	)
}

const checkAlarms = async (domia: DomiaType): Promise<void> => {
	console.log("\nen: alarms")
	const en = languageSetsFor("en")
	fake.connectedSatellite = null
	const alarm = await call(domia, "alarm", { at: "07:30" }, "sat-1")
	const row = fake.rows.find((r) => r.kind === "alarm" && !r.cancelled)
	const due = row ? new Date(row.dueAt) : null
	checker.check(
		"alarm schedules the next 07:30 with the alarmRing time param",
		alarm.status === "ok" &&
			!!due &&
			due.getHours() === 7 &&
			due.getMinutes() === 30 &&
			due.getTime() > Date.now() &&
			due.getTime() - Date.now() <= 86_400_000 &&
			!!row &&
			row.repeatDailyAt === null &&
			row.templateParams.time === en.spokenTime(due) &&
			alarm.speakableText === `Alarm set for ${en.spokenTime(due)}.`,
		`got=${JSON.stringify(alarm)} row=${JSON.stringify(row)}`,
	)
	const cancelled = await call(domia, "alarm_cancel", {}, "sat-1")
	checker.check(
		"alarm_cancel cancels the pending alarm",
		cancelled.status === "ok" &&
			cancelled.speakableText === "Alarm cancelled." &&
			fake.rows.every((r) => r.kind !== "alarm" || r.cancelled),
		`got=${JSON.stringify(cancelled)}`,
	)
	const none = await call(domia, "alarm_cancel", {}, "sat-1")
	checker.check(
		"alarm_cancel with nothing pending says so",
		none.status === "ok" && none.speakableText === "There's no alarm set.",
		`got=${JSON.stringify(none)}`,
	)
	const daily = await call(
		domia,
		"alarm",
		{ at: "06:00", daily: true },
		"sat-1",
	)
	const dailyRow = fake.rows.find((r) => r.kind === "alarm" && !r.cancelled)
	checker.check(
		"a daily alarm carries repeatDailyAt and says so",
		daily.status === "ok" &&
			dailyRow?.repeatDailyAt === "06:00" &&
			(daily.speakableText ?? "").startsWith("Daily alarm set for "),
		`got=${JSON.stringify(daily)} row=${JSON.stringify(dailyRow)}`,
	)
	await call(domia, "alarm_cancel", {}, "sat-1")
	const refused = await call(domia, "alarm", { at: "07:30" })
	checker.check(
		"alarm is refused when the identity has no announce target",
		refused.status === "error" &&
			refused.speakableText === "I can't do that from this device.",
		`got=${JSON.stringify(refused)}`,
	)
	const badTime = await call(domia, "alarm", { at: "25:00" }, "sat-1")
	checker.check(
		"alarm rejects an invalid clock time",
		badTime.status === "error" && badTime.isError,
		`got=${JSON.stringify(badTime)}`,
	)
}

const checkVolume = async (domia: DomiaType): Promise<void> => {
	console.log("\nen: voice volume")
	const wyomingOrigin: OriginCapabilitiesType = {
		...satelliteOrigin,
		satelliteProtocol: "wyoming",
		timerNative: false,
		volumeNative: false,
	}
	const gated = matchFastPath(domia, "turn your volume down", wyomingOrigin)
	checker.check(
		"a satellite without native volume makes volume unavailable",
		gated.kind === "miss" && gated.reason === "unavailable",
		`got=${JSON.stringify(gated)}`,
	)
	const chatGated = matchFastPath(domia, "turn your volume down", chatOrigin)
	checker.check(
		"an origin without local playback makes volume unavailable",
		chatGated.kind === "miss" && chatGated.reason === "unavailable",
		`got=${JSON.stringify(chatGated)}`,
	)
	const localOrigin: OriginCapabilitiesType = {
		...chatOrigin,
		source: "mic",
		canSpeak: true,
		canAnnounce: true,
		localPlayback: true,
	}
	const local = matchFastPath(domia, "turn your volume down", localOrigin)
	checker.check(
		"a local origin with playback matches volume",
		local.kind === "match" &&
			local.match.tool === "volume" &&
			local.match.resolvedArgs.direction === "down",
		`got=${JSON.stringify(local)}`,
	)
	fake.volumes.set(SATELLITE_VOLUME_KEY, 60)
	const down = await call(domia, "volume", { direction: "down" }, "sat-1")
	checker.check(
		"volume down steps the satellite's level by 10",
		down.status === "ok" &&
			fake.volumes.get(SATELLITE_VOLUME_KEY) === 50 &&
			down.speakableText === "Speaking softer. My volume is at 50 percent.",
		`got=${JSON.stringify(down)}`,
	)
	const set = await call(domia, "volume", { level: 35 }, "sat-1")
	checker.check(
		"volume level sets the exact percent",
		set.status === "ok" &&
			fake.volumes.get(SATELLITE_VOLUME_KEY) === 35 &&
			set.speakableText === "My volume is at 35 percent.",
		`got=${JSON.stringify(set)}`,
	)
	fake.volumes.set(SATELLITE_VOLUME_KEY, 100)
	const atMax = await call(domia, "volume", { direction: "up" }, "sat-1")
	checker.check(
		"volume up at the ceiling says so",
		atMax.status === "ok" &&
			atMax.speakableText === "I'm already at full volume.",
		`got=${JSON.stringify(atMax)}`,
	)
	const empty = await call(domia, "volume", {}, "sat-1")
	checker.check(
		"volume without direction or level is rejected",
		empty.status === "error" && empty.isError,
		`got=${JSON.stringify(empty)}`,
	)
}

const executeDirect = (
	domia: DomiaType,
	tool: string,
	args: Record<string, unknown>,
	interactionId: string,
) => {
	const builtin = DOMIA_TOOLS.find((t) => t.name === tool)
	if (!builtin) throw new Error(`unknown built-in tool ${tool}`)
	return builtin.execute(args, {
		domia,
		language: "en",
		sets: languageSetsFor("en"),
		interactionId,
		originDomiaKey: domia.domiaKey,
		origin: chatOrigin,
		runtime: fakePort,
	})
}

const checkMemory = async (domia: DomiaType): Promise<void> => {
	console.log("\nen: remember and forget")
	const interactionId = randomUUID()
	const remembered = await executeDirect(
		domia,
		"remember",
		{ subject: "user", relation: "has favorite color", value: "blue" },
		interactionId,
	)
	checker.check(
		"remember writes the fact and claims the reflection",
		remembered.status === "ok" &&
			remembered.speakableText === "Got it, I'll remember that." &&
			fake.facts.some(
				(f) => f.relation === "has favorite color" && f.value === "blue",
			) &&
			fake.reflectionClaims.includes(interactionId),
		`got=${JSON.stringify(remembered)} facts=${JSON.stringify(fake.facts)}`,
	)
	const rejectedId = randomUUID()
	const rejected = await executeDirect(
		domia,
		"remember",
		{ subject: "user", relation: "asked for", value: "the lights" },
		rejectedId,
	)
	checker.check(
		"a relation outside the allowlist is refused without claiming the reflection",
		rejected.status === "error" &&
			rejected.speakableText === "I couldn't keep that as a fact about you." &&
			!fake.reflectionClaims.includes(rejectedId),
		`got=${JSON.stringify(rejected)}`,
	)
	const viaEngine = await call(domia, "remember", {
		subject: "user",
		relation: "likes",
		value: "green tea",
	})
	checker.check(
		"remember reaches the executor through the engine with schema validation",
		viaEngine.status === "ok" &&
			fake.facts.some((f) => f.relation === "likes" && f.value === "green tea"),
		`got=${JSON.stringify(viaEngine)}`,
	)
	checker.check(
		"forget carries the confirm policy",
		getToolPolicy(domia.id, namespaced("forget")) === "confirm",
		`got=${getToolPolicy(domia.id, namespaced("forget"))}`,
	)
	const forgot = await call(domia, "forget", { what: "blue" })
	checker.check(
		"forget expires the matching fact after confirmation",
		forgot.status === "ok" &&
			forgot.speakableText === "Done, I've forgotten that." &&
			fake.expired.includes("blue") &&
			!fake.facts.some((f) => f.value === "blue"),
		`got=${JSON.stringify(forgot)}`,
	)
	const nothing = await call(domia, "forget", { what: "my car" })
	checker.check(
		"forget with no matching fact says so",
		nothing.status === "ok" &&
			nothing.speakableText ===
				"I don't have anything remembered about my car.",
		`got=${JSON.stringify(nothing)}`,
	)
	const forgetIt = matchFastPath(domia, "forget it", satelliteOrigin)
	checker.check(
		'"forget it" still ranks as cancel with forget mounted',
		forgetIt.kind === "match" && forgetIt.match.tool === "cancel",
		`got=${JSON.stringify(forgetIt)}`,
	)
}

const main = async (): Promise<void> => {
	setSkillRuntimePort(fakePort)
	const domias = Object.fromEntries(
		LANGUAGES.map((language) => {
			const id = randomUUID()
			const domia = domiaFor(id, language)
			fake.domias.set(id, domia)
			return [language, domia]
		}),
	) as Record<(typeof LANGUAGES)[number], DomiaType>
	const providers = LANGUAGES.map((language) =>
		providerFor(domias[language].id),
	)
	for (const [i, language] of LANGUAGES.entries()) {
		const connected = await connectProvider(providers[i], SLUG, language)
		checker.check(
			`${language}: the built-in provider connects with skillsEngine absent and fastPathEnabled=false`,
			connected && getConnectionsFor(domias[language].id).length === 1,
		)
	}
	for (const language of LANGUAGES) {
		checkPacks(domias[language], language)
		checkNegatives(domias[language], language)
	}
	checkRanking(domias.en)
	await checkExecutors(domias.en)
	await checkTimers(domias.en)
	await checkAlarms(domias.en)
	await checkVolume(domias.en)
	await checkMemory(domias.en)
	await disconnectProviders(providers.map((p) => p.id))
	for (const language of LANGUAGES) invalidateFastPathIndex(domias[language].id)
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} builtin-tools checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
