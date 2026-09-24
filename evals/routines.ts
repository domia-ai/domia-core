import { randomUUID } from "crypto"

import {
	BUILTIN_PROVIDER_ID_PREFIX,
	BUILTIN_PROVIDER_NAME,
	BUILTIN_PROVIDER_URL,
	ROUTINE_MAX_STEPS,
	SKILL_PROTOCOL_ENUM,
	SKILL_TRUST_TIER_ENUM,
	MCP_TRANSPORT_ENUM,
	type SelectSkillProviderType,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import { matchFastPath, invalidateFastPathIndex } from "@/modules/fast-path"
import {
	callTool,
	connectProvider,
	disconnectProviders,
	getConnectionsFor,
	getInvocationPolicy,
	getToolPolicy,
	listTools,
	saveRoutine,
	removeRoutine,
	routinesOf,
	invalidateRoutines,
	setSkillRuntimePort,
	type OriginCapabilitiesType,
	type SkillRuntimePortType,
} from "@/modules/skill-engine"
import type { RoutineInputType } from "@/modules/skill-engine/specializations/domia/types"
import { argsSchemaIssue } from "@/modules/skill-engine/utils/args-schema"
import {
	ensureRoster,
	playerRoster,
} from "@/modules/skill-engine/specializations/music-assistant/roster"
import { isDomiaError, SKILL_ERRORS, runWithTraceContext } from "@/utils"
import { baseLlmModelConfig, baseSkillProvider } from "@/test-utils/mocks"

import {
	execWrite,
	makeChecker,
	queryAll,
	startMockHa,
	startMockMusic,
} from "./lib"

const checker = makeChecker()

const DOMIA_ID = "eval-routines-domia"
const DOMIA_KEY = "eval-routines-key"
const HOME = "home"
const MUSIC = "music"
const GOOD_NIGHT = "domia__routine_good_night"
const LIGHTS_ON = "domia__routine_lights_on"
const NIGHT_MODE = "domia__routine_night_mode"
const BRIEFING = "domia__routine_briefing"
const TWO_DATES = "domia__routine_two_dates"
const OPEN_UP = "domia__routine_open_up"
const KITCHEN_QUEUE = "kitchen"

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

const providers = {
	builtin: {
		...baseSkillProvider(DOMIA_ID),
		id: `${BUILTIN_PROVIDER_ID_PREFIX}${DOMIA_ID}`,
		name: BUILTIN_PROVIDER_NAME,
		protocol: SKILL_PROTOCOL_ENUM.BUILTIN,
		type: MCP_TRANSPORT_ENUM.HTTP,
		url: BUILTIN_PROVIDER_URL,
		trustTier: SKILL_TRUST_TIER_ENUM.TRUSTED,
		descriptor: { version: 1 as const, kind: BUILTIN_PROVIDER_NAME },
		timeout: 3000,
		priority: 0,
	} satisfies SelectSkillProviderType,
	home: (url: string): SelectSkillProviderType => ({
		...baseSkillProvider(DOMIA_ID),
		id: "eval-routines-ha",
		name: HOME,
		url,
		timeout: 3000,
		descriptor: {
			version: 1,
			kind: "home-assistant",
			execution: {
				toolPolicy: {
					HassTurnOff: "allow",
					HassLightSet: "allow",
				},
			},
		},
	}),
	music: (url: string): SelectSkillProviderType => ({
		...baseSkillProvider(DOMIA_ID),
		id: "eval-routines-music",
		name: MUSIC,
		url,
		timeout: 3000,
		descriptor: {
			version: 1,
			kind: "music-assistant",
			execution: { toolPolicy: { playback_pause: "allow" } },
		},
	}),
}

const domiaWith = (cfgs: SelectSkillProviderType[]): DomiaType =>
	({
		id: DOMIA_ID,
		domiaKey: DOMIA_KEY,
		characterProfile: { name: "Domia", language: "en" },
		llmModelConfig: {
			...baseLlmModelConfig(DOMIA_ID),
			fastPathEnabled: true,
			agentBudgetMs: 15_000,
		},
		moduleSettings: null,
		runtimeCapabilities: null,
		skillProviders: cfgs,
	}) as unknown as DomiaType

const notUsed = (): Promise<never> =>
	Promise.reject(new Error("not used by routines"))

const portFor = (domia: DomiaType): SkillRuntimePortType => ({
	domiaOf: (domiaId) => Promise.resolve(domiaId === DOMIA_ID ? domia : null),
	originCapabilities: () => chatOrigin,
	announceTarget: () => ({ kind: "none" }),
	timers: {
		start: notUsed,
		cancel: notUsed,
		list: notUsed,
		remaining: () => 0,
	},
	schedule: {
		create: notUsed,
		cancel: notUsed,
		list: notUsed,
		wakeAt: () => undefined,
	},
	lastReply: () => Promise.resolve(null),
	volume: { get: notUsed, set: notUsed },
	facts: { upsert: notUsed, expire: notUsed },
	memory: { markReflectionCaptured: () => undefined },
})

const goodNight: RoutineInputType = {
	slug: "good_night",
	name: "Good night",
	description: "Turns every light off and pauses the music.",
	phrases: { en: ["good night [domia]"], es: ["buenas noches"] },
	steps: [
		{ tool: `${HOME}__HassTurnOff`, args: { domain: ["light"] } },
		{ tool: `${MUSIC}__playback_pause`, args: {} },
	],
	reply: { en: "Sleep well.", es: "Que descanses." },
}

const lightsOn: RoutineInputType = {
	slug: "lights_on",
	name: "Lights on",
	description: "Turns every light on.",
	phrases: { en: ["everything on"] },
	steps: [{ tool: `${HOME}__HassTurnOn`, args: { domain: ["light"] } }],
	reply: { en: "All lit." },
}

const nightMode: RoutineInputType = {
	slug: "night_mode",
	name: "Night mode",
	description: "Dims the kitchen light to a level.",
	phrases: { en: ["night mode at {level} percent"] },
	slots: { level: { source: { kind: "range", min: 1, max: 100 } } },
	steps: [
		{
			tool: `${HOME}__HassLightSet`,
			args: { name: "Kitchen Light", brightness: "{level}" },
		},
	],
	reply: { en: "Kitchen at {level} percent." },
}

const briefing: RoutineInputType = {
	slug: "briefing",
	name: "Briefing",
	description: "Says today's date.",
	phrases: { en: ["daily briefing"] },
	steps: [{ tool: "domia__date", args: {} }],
	reply: { en: "{speakable}" },
}

const twoDates: RoutineInputType = {
	slug: "two_dates",
	name: "Two dates",
	description: "Calls the same tool twice with the same arguments.",
	phrases: { en: ["date twice"] },
	steps: [
		{ tool: "domia__date", args: {} },
		{ tool: "domia__date", args: {} },
	],
	reply: { en: "Twice." },
}

const openUpGarageOnly: RoutineInputType = {
	slug: "open_up",
	name: "Open up",
	description: "Turns on whatever the door slot names.",
	phrases: { en: ["door routine for the {what}"] },
	slots: { what: { source: { kind: "enum", values: ["garage door"] } } },
	steps: [{ tool: `${HOME}__HassTurnOn`, args: { name: "{what}" } }],
	reply: { en: "Opened the {what}." },
}

const openUp: RoutineInputType = {
	...openUpGarageOnly,
	slots: {
		what: { source: { kind: "enum", values: ["garage door", "front door"] } },
	},
}

const lightSchema = {
	type: "object",
	properties: { name: { type: "string" }, brightness: { type: "integer" } },
	required: ["name"],
}

const refresh = async (domia: DomiaType): Promise<void> => {
	await listTools(domia, { force: true })
	invalidateFastPathIndex(DOMIA_ID)
}

const rejection = (fn: () => unknown): string | null => {
	try {
		fn()
		return null
	} catch (error) {
		return isDomiaError(error) &&
			error.code === SKILL_ERRORS.ROUTINE_INVALID.code
			? error.message
			: `unexpected: ${String(error)}`
	}
}

const call = (
	name: string,
	args: Record<string, unknown> = {},
	interactionId: string = randomUUID(),
	preResolved = true,
) =>
	runWithTraceContext({ interactionId, originDomiaKey: DOMIA_KEY }, () =>
		callTool(DOMIA_ID, name, args, undefined, preResolved),
	)

const startKitchen = async (cfg: SelectSkillProviderType): Promise<void> => {
	const conn = getConnectionsFor(DOMIA_ID).find((c) => c.providerSlug === MUSIC)
	if (!conn) return
	await conn.handle.callTool("playback_resume", { queue_id: KITCHEN_QUEUE })
	await playerRoster.refresh(cfg.id)
}

const homeContext = async (): Promise<string> => {
	const conn = getConnectionsFor(DOMIA_ID).find((c) => c.providerSlug === HOME)
	if (!conn) return ""
	return (await conn.handle.callTool("GetLiveContext", {})).text
}

const lightStates = (context: string): string[] =>
	context
		.split("\n- ")
		.filter((block) => block.includes("domain: light"))
		.map((block) => /state: (on|off)/.exec(block)?.[1] ?? "?")

const toolRunsOf = (interactionId: string): string[] =>
	queryAll<{ tool: string }>(
		"SELECT tool FROM tool_run WHERE interaction_id = ? ORDER BY rowid",
		[interactionId],
	).map((r) => r.tool)

const advertised = (): string[] =>
	[
		...(getConnectionsFor(DOMIA_ID).find(
			(c) => c.providerSlug === BUILTIN_PROVIDER_NAME,
		)?.allowedTools ?? []),
	].sort()

const purgeRows = (): void => {
	execWrite("DELETE FROM tool_run WHERE domia_id = ?", [DOMIA_ID])
	execWrite("DELETE FROM routine WHERE domia_id = ?", [DOMIA_ID])
	execWrite("DELETE FROM domia WHERE id = ?", [DOMIA_ID])
}

const main = async (): Promise<void> => {
	const ha = await startMockHa(0)
	const music = await startMockMusic(0)
	const home = providers.home(ha.url)
	const musicCfg = providers.music(music.url)
	const domia = domiaWith([providers.builtin, home, musicCfg])
	setSkillRuntimePort(portFor(domia))
	const cleanup = async (): Promise<void> => {
		await disconnectProviders([providers.builtin.id, home.id, musicCfg.id])
		invalidateFastPathIndex(DOMIA_ID)
		invalidateRoutines(DOMIA_ID)
		await ha.close()
		await music.close()
		purgeRows()
	}
	try {
		purgeRows()
		execWrite(
			"INSERT INTO domia (id, name, domia_key, is_active) VALUES (?, 'Eval routines', ?, 0)",
			[DOMIA_ID, DOMIA_KEY],
		)
		console.log("\n[setup] builtin + mock HA + mock MA connect")
		const connected = await Promise.all([
			connectProvider(providers.builtin, BUILTIN_PROVIDER_NAME, "en"),
			connectProvider(home, HOME, "en"),
			connectProvider(musicCfg, MUSIC, "en"),
		])
		checker.check("three providers connected", connected.every(Boolean))
		await refresh(domia)
		await ensureRoster(musicCfg)
		checker.check(
			"no routine tool is advertised before any routine exists",
			!advertised().some((t) => t.startsWith("routine_")),
			advertised().join(","),
		)

		console.log("\n[validation] bad routines are refused before persisting")
		const cases: [string, RoutineInputType][] = [
			["bad slug", { ...goodNight, slug: "Good Night" }],
			[
				`more than ${ROUTINE_MAX_STEPS} steps`,
				{
					...goodNight,
					steps: Array.from({ length: ROUTINE_MAX_STEPS + 1 }, () => ({
						tool: `${HOME}__HassTurnOff`,
						args: { domain: ["light"] },
					})),
				},
			],
			[
				"unknown step tool",
				{ ...goodNight, steps: [{ tool: `${HOME}__HassExplode`, args: {} }] },
			],
			[
				"argument not in the tool schema",
				{
					...goodNight,
					steps: [{ tool: `${HOME}__HassTurnOff`, args: { bogus: 1 } }],
				},
			],
			[
				"argument of the wrong type",
				{
					...goodNight,
					steps: [{ tool: `${HOME}__HassTurnOff`, args: { domain: "light" } }],
				},
			],
			[
				"template without literal text",
				{ ...nightMode, phrases: { en: ["{level}"] } },
			],
			[
				"template with an unknown slot",
				{ ...goodNight, phrases: { en: ["good night {room}"] } },
			],
			[
				"phrases without en",
				{ ...goodNight, phrases: { es: ["buenas noches"] } },
			],
			[
				"unknown language",
				{ ...goodNight, reply: { en: "ok", fr: "bonne nuit" } },
			],
			[
				"reply with an unknown placeholder",
				{ ...goodNight, reply: { en: "Done {room}" } },
			],
			[
				"context slot source",
				{
					...nightMode,
					slots: { level: { source: { kind: "context", key: "areas" } } },
				},
			],
		]
		for (const [label, input] of cases) {
			const message = rejection(() => saveRoutine(DOMIA_ID, input))
			checker.check(
				`${label} → ROUTINE_INVALID`,
				message !== null && !message.startsWith("unexpected"),
				message ?? "accepted",
			)
		}
		checker.check(
			"nothing was persisted by the refused routines",
			routinesOf(DOMIA_ID).length === 0,
		)

		console.log("\n[advertise] a saved routine becomes a built-in tool")
		const saved = saveRoutine(DOMIA_ID, goodNight)
		checker.check("good night is created", saved.created)
		saveRoutine(DOMIA_ID, lightsOn)
		saveRoutine(DOMIA_ID, nightMode)
		saveRoutine(DOMIA_ID, briefing)
		saveRoutine(DOMIA_ID, twoDates)
		await refresh(domia)
		checker.check(
			"domia__routine_good_night is advertised after the refresh",
			advertised().includes("routine_good_night"),
			advertised().join(","),
		)
		const cycle = rejection(() =>
			saveRoutine(DOMIA_ID, {
				...goodNight,
				slug: "chain",
				steps: [{ tool: GOOD_NIGHT, args: {} }],
			}),
		)
		checker.check(
			"a routine calling another routine is rejected",
			cycle?.includes("routines may not call routines") === true,
			cycle ?? "accepted",
		)
		const updated = saveRoutine(DOMIA_ID, {
			...goodNight,
			description: "Lights off, music paused.",
		})
		checker.check(
			"saving the same slug again updates in place",
			!updated.created && updated.routine.id === saved.routine.id,
		)
		await refresh(domia)

		console.log("\n[fast path] phrases compile into intents")
		const match = matchFastPath(domia, "good night", chatOrigin)
		checker.check(
			'"good night" fast-paths domia__routine_good_night',
			match.kind === "match" && match.match.namespacedName === GOOD_NIGHT,
			JSON.stringify(match),
		)
		const withName = matchFastPath(domia, "good night domia", chatOrigin)
		checker.check(
			'"good night domia" matches through the optional',
			withName.kind === "match" && withName.match.namespacedName === GOOD_NIGHT,
			JSON.stringify(withName),
		)
		const slotted = matchFastPath(domia, "night mode at 30 percent", chatOrigin)
		checker.check(
			"a range slot captures the level",
			slotted.kind === "match" &&
				slotted.match.namespacedName === NIGHT_MODE &&
				slotted.match.resolvedArgs.level === 30,
			JSON.stringify(slotted),
		)
		const chat = matchFastPath(domia, "tell me a joke", chatOrigin)
		checker.check(
			"chat stays off the routine fast path",
			chat.kind === "miss",
			JSON.stringify(chat),
		)

		console.log("\n[policy] inherited from the steps")
		checker.check(
			"good night inherits allow",
			getToolPolicy(DOMIA_ID, GOOD_NIGHT) === "allow",
			getToolPolicy(DOMIA_ID, GOOD_NIGHT),
		)
		checker.check(
			"lights on inherits allow from HassTurnOn on the light domain",
			getToolPolicy(DOMIA_ID, LIGHTS_ON) === "allow",
			getToolPolicy(DOMIA_ID, LIGHTS_ON),
		)
		const lit = await call(LIGHTS_ON, {}, randomUUID(), false)
		checker.check(
			"an allow routine runs unconfirmed and speaks its reply",
			lit.status === "ok" && lit.speakableText === "All lit.",
			JSON.stringify(lit),
		)
		checker.check(
			"every light is on afterwards",
			lightStates(await homeContext()).every((s) => s === "on"),
			await homeContext(),
		)

		console.log(
			"\n[placeholder policy] a slot that can name a lock gates the routine",
		)
		saveRoutine(DOMIA_ID, openUpGarageOnly)
		await refresh(domia)
		checker.check(
			"open up is allow while no slot value names a sensitive entity",
			getToolPolicy(DOMIA_ID, OPEN_UP) === "allow",
			getToolPolicy(DOMIA_ID, OPEN_UP),
		)
		saveRoutine(DOMIA_ID, openUp)
		const staleId = randomUUID()
		const stale = await call(OPEN_UP, { what: "front door" }, staleId, false)
		checker.check(
			"a lock-targeting step is not run while the routine is still advertised as allow",
			stale.status === "blocked" &&
				stale.isError &&
				!toolRunsOf(staleId).includes(`${HOME}__HassTurnOn`),
			`${JSON.stringify(stale)} ${toolRunsOf(staleId).join(" → ")}`,
		)
		await refresh(domia)
		checker.check(
			"after the refresh the routine is advertised as confirm",
			getToolPolicy(DOMIA_ID, OPEN_UP) === "confirm",
			getToolPolicy(DOMIA_ID, OPEN_UP),
		)
		const door = matchFastPath(
			domia,
			"door routine for the front door",
			chatOrigin,
		)
		checker.check(
			"the fast path resolves the enum slot and the invocation policy is confirm",
			door.kind === "match" &&
				door.match.namespacedName === OPEN_UP &&
				door.match.resolvedArgs.what === "front door" &&
				getInvocationPolicy(DOMIA_ID, OPEN_UP, door.match.resolvedArgs)
					.policy === "confirm",
			JSON.stringify(door),
		)
		for (const what of ["front door", "garage door"]) {
			const id = randomUUID()
			const unconfirmed = await call(OPEN_UP, { what }, id, false)
			checker.check(
				`"${what}" is not run without a claimed confirmation`,
				unconfirmed.status === "blocked" &&
					!toolRunsOf(id).includes(`${HOME}__HassTurnOn`),
				JSON.stringify(unconfirmed),
			)
		}
		const openedId = randomUUID()
		const opened = await call(OPEN_UP, { what: "front door" }, openedId)
		checker.check(
			"the confirmed routine runs its step and renders the slot in the reply",
			!opened.isError &&
				opened.speakableText === "Opened the front door." &&
				toolRunsOf(openedId).includes(`${HOME}__HassTurnOn`),
			`${JSON.stringify(opened)} ${toolRunsOf(openedId).join(" → ")}`,
		)

		console.log(
			"\n[args schema] placeholders only on the routine path, numeric strings coerced",
		)
		checker.check(
			"LLM path: braces inside a string argument are not placeholders",
			argsSchemaIssue({ name: "Kitchen {Light}" }, lightSchema) === null,
			argsSchemaIssue({ name: "Kitchen {Light}" }, lightSchema) ?? "",
		)
		checker.check(
			"LLM path: a numeric string satisfies an integer property",
			argsSchemaIssue(
				{ name: "Kitchen Light", brightness: "40" },
				lightSchema,
			) === null,
		)
		checker.check(
			"LLM path: a non-numeric string still fails an integer property",
			argsSchemaIssue(
				{ name: "Kitchen Light", brightness: "dim" },
				lightSchema,
			) !== null,
		)
		checker.check(
			"routine path: an unknown placeholder is rejected",
			argsSchemaIssue({ name: "{what}" }, lightSchema, new Set(["level"])) !==
				null,
		)
		checker.check(
			"routine path: a whole placeholder skips the type check",
			argsSchemaIssue(
				{ name: "Kitchen Light", brightness: "{level}" },
				lightSchema,
				new Set(["level"]),
			) === null,
		)

		console.log("\n[execution] steps run in order, reply rendered")
		await startKitchen(musicCfg)
		const interactionId = randomUUID()
		const run = await call(GOOD_NIGHT, {}, interactionId)
		checker.check(
			"good night succeeds",
			run.status === "ok" && !run.isError,
			JSON.stringify(run),
		)
		checker.check(
			'reply is "Sleep well."',
			run.speakableText === "Sleep well.",
			run.speakableText ?? "",
		)
		checker.check(
			"every light is off",
			lightStates(await homeContext()).every((s) => s === "off"),
			await homeContext(),
		)
		const state = await music.state()
		checker.check(
			"the playing kitchen player is paused",
			state.players.some(
				(p) => p.player_id === KITCHEN_QUEUE && p.state === "paused",
			),
			JSON.stringify(state.players.map((p) => [p.name, p.state])),
		)
		const runs = toolRunsOf(interactionId)
		checker.check(
			"one tool_run row per step, in order, after the routine's own row",
			runs.length === 3 &&
				runs[0] === GOOD_NIGHT &&
				runs[1] === `${HOME}__HassTurnOff` &&
				runs[2] === `${MUSIC}__playback_pause`,
			runs.join(" → "),
		)
		checker.check(
			"text aggregates the step outputs",
			run.text.includes("HassTurnOff") && run.text.includes("playback_pause"),
			run.text,
		)
		const twiceId = randomUUID()
		const twice = await call(TWO_DATES, {}, twiceId)
		const twiceRuns = toolRunsOf(twiceId)
		checker.check(
			"two identical consecutive steps both run (one tool_run each)",
			twice.status === "ok" &&
				!twice.isError &&
				twiceRuns.length === 3 &&
				twiceRuns[1] === "domia__date" &&
				twiceRuns[2] === "domia__date",
			`${twice.status} ${twiceRuns.join(" → ")}`,
		)
		const dimmed = await call(NIGHT_MODE, { level: 30 })
		checker.check(
			"placeholders resolve from the routine args and the reply renders them",
			dimmed.status === "ok" &&
				dimmed.speakableText === "Kitchen at 30 percent." &&
				(await homeContext()).includes("brightness: 30"),
			JSON.stringify(dimmed),
		)

		const briefed = await call(BRIEFING)
		checker.check(
			"{speakable} in a reply renders the step speakables",
			briefed.status === "ok" &&
				(briefed.speakableText ?? "").startsWith("Today is "),
			JSON.stringify(briefed),
		)

		console.log("\n[failure] a failing first step stops the chain")
		await music.reset()
		await startKitchen(musicCfg)
		await ha.setBehavior({ fail: { HassTurnOff: "always" } })
		const failed = await call(GOOD_NIGHT)
		checker.check(
			"the routine reports the failure",
			failed.isError && failed.status !== "ok",
			JSON.stringify(failed),
		)
		checker.check(
			"the second step never ran",
			!(await music.state()).players.some((p) => p.state === "paused"),
		)
		await ha.setBehavior({})

		console.log("\n[offline] a step whose provider is gone blocks the routine")
		await disconnectProviders([musicCfg.id])
		await refresh(domia)
		checker.check(
			"good night is blocked while music is offline",
			getToolPolicy(DOMIA_ID, GOOD_NIGHT) === "block",
			getToolPolicy(DOMIA_ID, GOOD_NIGHT),
		)
		const blocked = await call(GOOD_NIGHT)
		checker.check(
			"calling it is refused",
			blocked.status === "blocked" && blocked.isError,
			JSON.stringify(blocked),
		)
		const offline = rejection(() =>
			saveRoutine(DOMIA_ID, { ...goodNight, slug: "good_night_2" }),
		)
		checker.check(
			"a new routine referencing the offline provider is refused",
			offline?.includes("not available") === true,
			offline ?? "accepted",
		)
		await connectProvider(musicCfg, MUSIC, "en")
		await refresh(domia)
		checker.check(
			"reconnecting restores allow",
			getToolPolicy(DOMIA_ID, GOOD_NIGHT) === "allow",
			getToolPolicy(DOMIA_ID, GOOD_NIGHT),
		)

		console.log("\n[delete] removing the routine drops the tool")
		checker.check(
			"delete returns true",
			removeRoutine(DOMIA_ID, saved.routine.id),
		)
		await refresh(domia)
		checker.check(
			"domia__routine_good_night is no longer advertised",
			!advertised().includes("routine_good_night"),
			advertised().join(","),
		)
		checker.check(
			"deleting again returns false",
			!removeRoutine(DOMIA_ID, saved.routine.id),
		)
	} finally {
		await cleanup()
	}
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} routines checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
