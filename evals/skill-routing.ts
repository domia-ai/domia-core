import { randomUUID } from "crypto"

import {
	DEFAULT_TOOL_SHORTLIST_MAX,
	DEFAULT_TOOL_SHORTLIST_RANKED_RESERVE,
	SKILLS_ROUTING_ENUM,
	type SkillToolType,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import { rankTools, type ScoredToolType } from "@/modules/matcher"
import { judgeRequestOf, requestedToolOf } from "@/modules/intent-router"
import {
	domiaSpecialization,
	homeAssistantSpecialization,
	musicAssistantSpecialization,
	shortlistTools,
} from "@/modules/skill-engine"
import { DOMIA_TOOLS } from "@/modules/skill-engine/specializations/domia/tools"
import { maVirtualTools } from "@/modules/skill-engine/specializations/music-assistant/virtual-tools"
import {
	expectedActionTools,
	judgeCatalogOf,
	namedToolsOnly,
} from "@/modules/core-bus/utils/skill-routing"
import {
	setOpenRequest,
	takeOpenRequest,
} from "@/modules/core-bus/utils/open-request"
import { baseLlmModelConfig } from "@/test-utils/mocks/llm-model-config"

import { makeChecker } from "./lib"

const checker = makeChecker()

const HOME = "home-assistant"
const MUSIC = "music-assistant"
const BUILTIN = "domia"

const tool = (
	provider: string,
	rawName: string,
	description: string,
): SkillToolType => ({
	provider,
	rawName,
	namespacedName: `${provider}__${rawName}`,
	description,
	inputSchema: { type: "object", properties: { name: { type: "string" } } },
})

const HOME_TOOLS = [
	tool(
		HOME,
		"GetLiveContext",
		"Provides real-time information about the CURRENT state, value, or mode of devices, sensors, entities, or areas.",
	),
	tool(
		HOME,
		"HassTurnOn",
		"Turns on/opens/presses a device or entity. Use for requests like 'turn on', 'activate', 'enable'.",
	),
	tool(
		HOME,
		"HassTurnOff",
		"Turns off/closes a device or entity. Use for requests like 'turn off', 'deactivate', 'disable'.",
	),
	tool(
		HOME,
		"HassSetPosition",
		"Sets the position of a device or entity, such as a cover.",
	),
	tool(
		HOME,
		"HassLightSet",
		"Sets the brightness percentage or color of a light",
	),
	tool(
		HOME,
		"HassClimateSetTemperature",
		"Sets the target temperature of a climate device.",
	),
	tool(HOME, "HassLockDoor", "Locks a door lock entity."),
	tool(HOME, "HassUnlockDoor", "Unlocks a door lock entity."),
]

const MUSIC_TOOLS = [
	tool(MUSIC, "playback_pause", "Pauses playback on a player queue."),
	tool(MUSIC, "playback_resume", "Resumes playback on a player queue."),
	tool(
		MUSIC,
		"playback_next_track",
		"Skips to the next track on a player queue.",
	),
	tool(
		MUSIC,
		"playback_previous_track",
		"Goes back to the previous track on a player queue.",
	),
	tool(
		MUSIC,
		"volume_volume_set",
		"Sets the volume of a player to an absolute level.",
	),
	tool(MUSIC, "volume_volume_up", "Raises the volume of a player one step."),
	tool(MUSIC, "volume_volume_down", "Lowers the volume of a player one step."),
	tool(MUSIC, "volume_volume_mute", "Mutes or unmutes a player."),
	...maVirtualTools().map((t) => tool(MUSIC, t.name, t.description ?? "")),
]

const BUILTIN_TOOLS = [
	...DOMIA_TOOLS.filter((t) => !t.hiddenFromLlm).map((t) =>
		tool(BUILTIN, t.name, t.definition.description ?? ""),
	),
	tool(
		BUILTIN,
		"routine_good_night",
		"Turns the lights off, locks the front door and sets the morning alarm.",
	),
]

const ALL_TOOLS = [...HOME_TOOLS, ...MUSIC_TOOLS, ...BUILTIN_TOOLS]
const BUILTIN_NAMES = new Set(BUILTIN_TOOLS.map((t) => t.namespacedName))

const descriptors = [
	homeAssistantSpecialization.descriptorDefaults?.(HOME_TOOLS, "en"),
	musicAssistantSpecialization.descriptorDefaults?.(MUSIC_TOOLS, "en"),
	domiaSpecialization.descriptorDefaults?.(BUILTIN_TOOLS, "en"),
]

const ALIASES = descriptors.reduce<Record<string, string[]>>(
	(merged, descriptor) => {
		for (const [key, values] of Object.entries(
			descriptor?.routing?.aliases ?? {},
		))
			merged[key.toLowerCase()] = [
				...(merged[key.toLowerCase()] ?? []),
				...values.map((v) => v.toLowerCase()),
			]
		return merged
	},
	{},
)

const CORE_RAW = new Set(descriptors.flatMap((d) => d?.execution?.coreTools))
const CORE_NAMES = new Set(
	ALL_TOOLS.filter(
		(t) => !BUILTIN_NAMES.has(t.namespacedName) && CORE_RAW.has(t.rawName),
	).map((t) => t.namespacedName),
)

const domia = {
	id: randomUUID(),
	domiaKey: "SKILL_ROUTING_EVAL",
	characterProfile: { name: "Domia", language: "en" },
	llmModelConfig: {
		...baseLlmModelConfig(),
		skillsRouting: SKILLS_ROUTING_ENUM.TOOL_JUDGE,
	},
} as unknown as DomiaType

const shortlistFor = async (transcript: string): Promise<SkillToolType[]> => {
	const scored = await rankTools(domia, transcript, ALL_TOOLS, {
		aliases: ALIASES,
	})
	return shortlistTools(
		scored.filter(
			(r) => r.score > 0 || !BUILTIN_NAMES.has(r.tool.namespacedName),
		),
		DEFAULT_TOOL_SHORTLIST_MAX,
		{
			coreNames: CORE_NAMES,
			rankedReserve: DEFAULT_TOOL_SHORTLIST_RANKED_RESERVE,
		},
	).tools
}

const rawNames = (tools: SkillToolType[]): string[] =>
	tools.map((t) => t.rawName)

const SHORTLIST_CASES: { text: string; must: string[] }[] = [
	{ text: "Lock the front door.", must: ["HassLockDoor"] },
	{ text: "Unlock the front door.", must: ["HassUnlockDoor"] },
	{
		text: "Play some jazz in the living room.",
		must: ["music_play"],
	},
	{
		text: "Set the thermostat to 21 degrees.",
		must: ["HassClimateSetTemperature", "GetLiveContext"],
	},
	{ text: "Is the front door locked?", must: ["GetLiveContext"] },
]

const checkDemoShortlist = async (): Promise<void> => {
	console.log("\ncore tools never starve the tool the utterance names")
	checker.check(
		"the demo tool set saturates the shortlist with core tools alone",
		CORE_NAMES.size >= DEFAULT_TOOL_SHORTLIST_MAX,
		`core=${CORE_NAMES.size} max=${DEFAULT_TOOL_SHORTLIST_MAX}`,
	)
	for (const { text, must } of SHORTLIST_CASES) {
		const kept = rawNames(await shortlistFor(text))
		checker.check(
			`"${text}" offers ${must.join(" + ")}`,
			must.every((name) => kept.includes(name)) &&
				kept.length <= Math.max(DEFAULT_TOOL_SHORTLIST_MAX, CORE_NAMES.size),
			kept.join(","),
		)
	}
}

const scoredOf = (scores: [SkillToolType, number][]): ScoredToolType[] =>
	scores
		.map(([scoredTool, score], index) => ({ tool: scoredTool, score, index }))
		.sort((a, b) => b.score - a.score || a.index - b.index)

const checkReserveRules = (): void => {
	console.log("\nthe ranked reserve displaces only weaker core tools")
	const [context, turnOn, turnOff] = HOME_TOOLS
	const lock = HOME_TOOLS[6]
	const unlock = HOME_TOOLS[7]
	const reminder = tool(BUILTIN, "reminder", "Sets a spoken reminder.")
	const core = new Set([context, turnOn, turnOff].map((t) => t.namespacedName))
	const saturated = shortlistTools(
		scoredOf([
			[context, 0],
			[turnOn, 0],
			[turnOff, 3],
			[lock, 9],
			[unlock, 5],
			[reminder, 1],
		]),
		3,
		{ coreNames: core, rankedReserve: 2 },
	).tools
	checker.check(
		"two stronger challengers replace the two weakest core tools",
		rawNames(saturated).sort().join(",") ===
			["HassLockDoor", "HassTurnOff", "HassUnlockDoor"].sort().join(","),
		rawNames(saturated).join(","),
	)
	const outranked = shortlistTools(
		scoredOf([
			[context, 4],
			[turnOn, 8],
			[turnOff, 6],
			[lock, 2],
		]),
		3,
		{ coreNames: core, rankedReserve: 2 },
	).tools
	checker.check(
		"a challenger weaker than every core tool displaces nothing",
		rawNames(outranked).join(",") === "GetLiveContext,HassTurnOn,HassTurnOff",
		rawNames(outranked).join(","),
	)
	const noReserve = shortlistTools(
		scoredOf([
			[context, 0],
			[turnOn, 0],
			[turnOff, 0],
			[lock, 9],
		]),
		3,
		{ coreNames: core },
	).tools
	checker.check(
		"without a reserve the core tools fill a saturated shortlist",
		rawNames(noReserve).join(",") === "GetLiveContext,HassTurnOn,HassTurnOff",
		rawNames(noReserve).join(","),
	)
	const roomy = shortlistTools(
		scoredOf([
			[context, 0],
			[turnOn, 0],
			[turnOff, 0],
			[lock, 9],
			[unlock, 5],
		]),
		5,
		{ coreNames: core, rankedReserve: 2 },
	).tools
	checker.check(
		"a shortlist with free room keeps every core tool and adds the ranked ones",
		rawNames(roomy).sort().join(",") ===
			[
				"GetLiveContext",
				"HassLockDoor",
				"HassTurnOff",
				"HassTurnOn",
				"HassUnlockDoor",
			].join(","),
		rawNames(roomy).join(","),
	)
	const silent = shortlistTools(
		scoredOf([
			[context, 0],
			[turnOn, 0],
			[turnOff, 0],
			[lock, 0],
		]),
		3,
		{ coreNames: core, rankedReserve: 2 },
	).tools
	checker.check(
		"an utterance that ranks nothing keeps the core tools",
		rawNames(silent).join(",") === "GetLiveContext,HassTurnOn,HassTurnOff",
		rawNames(silent).join(","),
	)
}

const checkNamedToolOnly = (): void => {
	console.log("\nwhen a tool is named, only that tool is offered")
	const remember = `${BUILTIN}__remember`
	const alarm = `${BUILTIN}__alarm`
	const forRemember = rawNames(namedToolsOnly(ALL_TOOLS, [remember]))
	checker.check(
		"remember is offered alone",
		forRemember.join() === "remember",
		forRemember.join(","),
	)
	const withoutAlarm = ALL_TOOLS.filter((t) => t.namespacedName !== alarm)
	checker.check(
		"a named tool that is unavailable offers nothing and expects nothing",
		namedToolsOnly(withoutAlarm, [alarm]).length === 0 &&
			expectedActionTools(withoutAlarm, [alarm]).length === 0,
	)
	checker.check(
		"with no tool named every tool stays offered and nothing is expected",
		namedToolsOnly(ALL_TOOLS, []).length === ALL_TOOLS.length &&
			expectedActionTools(ALL_TOOLS, []).length === 0,
	)
	checker.check(
		"the named tool is the one expected to be called",
		expectedActionTools(ALL_TOOLS, [remember]).join() === remember,
	)
}

const checkJudgeCatalog = async (): Promise<void> => {
	console.log("\nthe judge sees one stable catalog with readable names")
	const sorted = [...ALL_TOOLS].sort((a, b) =>
		a.namespacedName.localeCompare(b.namespacedName),
	)
	const catalog = judgeCatalogOf(
		sorted,
		{ [`${MUSIC}__playback_pause`]: ["pause the music"] },
		{ [`${MUSIC}__playback_pause`]: "pause_music" },
	)
	checker.check(
		"a tool label replaces its raw name for the judge",
		catalog.byName.get("pause_music")?.rawName === "playback_pause" &&
			!catalog.byName.has("playback_pause"),
	)
	checker.check(
		"examples travel with the renamed tool",
		catalog.hints.find((h) => h.name === "pause_music")?.examples?.[0] ===
			"pause the music",
	)
	const twin = tool("other-home", "HassTurnOn", "Turns on a device.")
	const clashing = judgeCatalogOf([...sorted, twin], {}, {})
	checker.check(
		"two providers with the same tool name are told apart by provider",
		clashing.byName.has("home-assistant:HassTurnOn") &&
			clashing.byName.has("other-home:HassTurnOn") &&
			!clashing.byName.has("HassTurnOn"),
	)
	const request = judgeRequestOf("x", catalog.hints)
	checker.check(
		"the judge is offered every tool and none",
		request !== null &&
			request.choices.length === catalog.hints.length + 1 &&
			request.choices.at(-1) === "none",
	)
	const bloated = Array.from({ length: 400 }, (_, i) => ({
		name: `tool_${i}`,
		description: "x".repeat(300),
		examples: ["one example sentence", "another example sentence"],
	}))
	const trimmed = judgeRequestOf("x", bloated.slice(0, 60))
	checker.check(
		"over budget, descriptions give way before examples",
		trimmed !== null &&
			!trimmed.system.includes("xxxxxxxx") &&
			trimmed.system.includes("Examples:"),
	)
	checker.check(
		"a catalog that cannot fit skips the judge",
		judgeRequestOf("x", bloated) === null,
	)
	const skipped = await requestedToolOf(domia, "x", bloated)
	checker.check(
		"a skipped judge is a failure, not a none",
		skipped.tool === null && skipped.failed,
	)
	const failing = await requestedToolOf(domia, "x", catalog.hints, () =>
		Promise.reject(new Error("hub down")),
	)
	checker.check(
		"a judge that errors is a failure, not a none",
		failing.tool === null && failing.failed,
	)
	const none = await requestedToolOf(
		domia,
		"I had a lovely day.",
		catalog.hints,
		() => Promise.resolve('{"tool": "none"}'),
	)
	checker.check(
		"a judge that answers none is not a failure",
		none.tool === null && !none.failed,
	)
	const named = await requestedToolOf(
		domia,
		"Pause the song.",
		catalog.hints,
		() => Promise.resolve('{"tool": "pause_music"}'),
	)
	const repeated = await requestedToolOf(
		domia,
		"Pause the song.",
		catalog.hints,
		() => Promise.reject(new Error("must not be asked again")),
	)
	checker.check(
		"an exact repeat is answered from the cache without the judge",
		repeated.tool === "pause_music" && !repeated.failed,
	)
	checker.check(
		"a remote judge names a tool by its label",
		named.tool === "pause_music",
	)
}

const checkOpenRequest = (): void => {
	console.log("\na short answer is joined to the request that asked for it")
	const scope = "SKILL_ROUTING_EVAL:sat-1"
	setOpenRequest(scope, "Set a timer for the pasta.")
	checker.check(
		"a short answer takes the open request",
		takeOpenRequest(scope, "Ten minutes.")?.transcript ===
			"Set a timer for the pasta.",
	)
	checker.check(
		"an open request is taken once",
		takeOpenRequest(scope, "Ten minutes.") === null,
	)
	setOpenRequest(scope, "Set a timer for the pasta.")
	checker.check(
		"a long new sentence is not an answer and drops the open request",
		takeOpenRequest(
			scope,
			"Actually tell me about the history of pasta in the south of Italy.",
		) === null && takeOpenRequest(scope, "Ten minutes.") === null,
	)
	checker.check(
		"another room never takes this room's open request",
		(setOpenRequest(scope, "Set a timer."),
		takeOpenRequest("SKILL_ROUTING_EVAL:sat-2", "Ten minutes.")) === null,
	)
}

const main = async (): Promise<void> => {
	checkReserveRules()
	await checkDemoShortlist()
	checkNamedToolOnly()
	await checkJudgeCatalog()
	checkOpenRequest()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} skill-routing checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
