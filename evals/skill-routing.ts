import { randomUUID } from "crypto"

import {
	DEFAULT_TOOL_SHORTLIST_MAX,
	DEFAULT_TOOL_SHORTLIST_RANKED_RESERVE,
	SKILLS_ROUTING_ENUM,
	type SkillToolType,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import { rankTools, type ScoredToolType } from "@/modules/matcher"
import {
	builtinKeywordHits,
	classifyNeedsSkill,
	resetIntentCache,
} from "@/modules/intent-router"
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
	namedActionToolsOnly,
} from "@/modules/core-bus/utils/skill-routing"
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

const BUILTIN_KEYWORDS: Record<string, string[]> = {
	en:
		domiaSpecialization.descriptorDefaults?.(BUILTIN_TOOLS, "en").routing
			?.keywords ?? [],
	es:
		domiaSpecialization.descriptorDefaults?.(BUILTIN_TOOLS, "es").routing
			?.keywords ?? [],
}

const domia = {
	id: randomUUID(),
	domiaKey: "SKILL_ROUTING_EVAL",
	characterProfile: { name: "Domia", language: "en" },
	llmModelConfig: {
		...baseLlmModelConfig(),
		skillsRouting: SKILLS_ROUTING_ENUM.EMBEDDING_GATE,
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
		text: "Remind me to water the plants at 9 tonight.",
		must: ["reminder"],
	},
	{
		text: "Remind me at nine tonight to water the plants.",
		must: ["reminder"],
	},
	{ text: "Forget what I said about the pantry.", must: ["forget"] },
	{ text: "Remember that I am allergic to cilantro.", must: ["remember"] },
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

const DELEGATED_CHAT = [
	"Honestly, I'm wiped out and stressed about dinner. I have salmon, lemons, and asparagus. What can I cook tonight?",
	"Thanks. That actually helps a little.",
	"What should I keep in the pantry instead?",
	"Does tonight's menu have nuts?",
	"does the menu have nuts",
	"is there anything with gluten tonight",
	"Luna, tell me a short bedtime story about a dragon who is afraid of the dark.",
]

const DELEGATED_SKILL = [
	"Lock the front door.",
	"Set the thermostat to 21 degrees.",
	"Play some jazz in the living room.",
	"Turn everything off.",
]

const checkDelegatedGate = async (): Promise<void> => {
	console.log("\na node without a local LLM still gates chat from skills")
	const decide = async (
		transcript: string,
	): Promise<{ needsSkill: boolean; reason: string }> => {
		resetIntentCache()
		const routable = (await shortlistFor(transcript)).filter(
			(t) => !BUILTIN_NAMES.has(t.namespacedName),
		)
		return classifyNeedsSkill(
			domia,
			transcript,
			routable.map((t) => ({ name: t.rawName, description: t.description })),
			{ canRunLlm: false },
		)
	}
	for (const text of DELEGATED_CHAT) {
		const decision = await decide(text)
		checker.check(
			`chat stays chat: "${text.slice(0, 60)}"`,
			!decision.needsSkill,
			decision.reason,
		)
	}
	for (const text of DELEGATED_SKILL) {
		const decision = await decide(text)
		checker.check(
			`a command reaches the agent: "${text}"`,
			decision.needsSkill,
			decision.reason,
		)
	}
	const noTools = await classifyNeedsSkill(
		{
			...domia,
			llmModelConfig: {
				...domia.llmModelConfig,
				skillsRouting: SKILLS_ROUTING_ENUM.INTENT_GATE,
			},
		} as DomiaType,
		"Lock the front door.",
		[{ name: "HassLockDoor", description: "Locks a door lock entity." }],
		{ canRunLlm: false },
	)
	checker.check(
		"a classifier that cannot run locally hands the turn to the peer agent",
		noTools.needsSkill && noTools.reason === "no-local-llm",
		JSON.stringify(noTools),
	)
}

const KEYWORD_CASES: {
	text: string
	language: string
	hit: boolean
}[] = [
	{
		text: "Remind me to water the plants at 9 tonight.",
		language: "en",
		hit: true,
	},
	{
		text: "Remind me at nine tonight to water the plants.",
		language: "en",
		hit: true,
	},
	{
		text: "Forget what I said about the pantry.",
		language: "en",
		hit: true,
	},
	{
		text: "Atlas, remind me what's happening this Friday.",
		language: "en",
		hit: false,
	},
	{ text: "Remind me when the bins go out.", language: "en", hit: false },
	{
		text: "One of them is vegetarian, by the way.",
		language: "en",
		hit: false,
	},
	{
		text: "Remind me to call mom if it rains.",
		language: "en",
		hit: true,
	},
	{
		text: "Remember that my favorite tea is jasmine.",
		language: "en",
		hit: true,
	},
	{ text: "Remember that my name is Kevin.", language: "en", hit: true },
	{
		text: "Do you remember that my name is Kevin?",
		language: "en",
		hit: false,
	},
	{ text: "Don't forget about the milk.", language: "en", hit: false },
	{ text: "She said remind me at five.", language: "en", hit: false },
	{
		text: "Recuérdame regar las plantas a las nueve.",
		language: "es",
		hit: true,
	},
	{
		text: "Recuérdame qué pasa este viernes.",
		language: "es",
		hit: false,
	},
]

const checkBuiltinKeywords = (): void => {
	console.log("\nbuilt-in keywords route commands, never recall questions")
	for (const { text, language, hit } of KEYWORD_CASES) {
		const found = builtinKeywordHits(text, language, BUILTIN_KEYWORDS[language])
		checker.check(
			`${hit ? "routes" : "leaves"} "${text}"`,
			found.length > 0 === hit,
			`hit=${found.join(",")}`,
		)
	}
}

const BUILTIN_TOOL_KEYWORDS = Object.fromEntries(
	Object.entries(
		domiaSpecialization.descriptorDefaults?.(BUILTIN_TOOLS, "en").routing
			?.aliases ?? {},
	).map(([name, keywords]) => [`${BUILTIN}__${name}`, keywords]),
)

const READ_BUILTINS = new Set(
	DOMIA_TOOLS.filter(
		(t) => t.definition.annotations?.readOnlyHint === true,
	).map((t) => `${BUILTIN}__${t.name}`),
)

const EXPECTATION_CASES: { text: string; expected: string[] }[] = [
	{ text: "I had a great time at the party.", expected: [] },
	{ text: "What time is it?", expected: [] },
	{ text: "We had our first date in Paris.", expected: [] },
	{ text: "I'll be there in ten minutes.", expected: [] },
	{ text: "Forget about it, it doesn't matter.", expected: [] },
	{ text: "Remind me to call mom at five.", expected: ["reminder"] },
	{ text: "Forget what I said about the pantry.", expected: ["forget"] },
	{ text: "Set a timer for the pasta.", expected: ["timer"] },
	{ text: "Remember that I am allergic to cilantro.", expected: ["remember"] },
]

const CHAT_SENTENCES: Record<string, string[]> = {
	en: [
		"I had a great time at the party last night.",
		"We had our first date in Paris, you know.",
		"I woke up at six o'clock.",
		"It took an hour to get home.",
		"I'll be there in ten minutes.",
	],
	es: [
		"Tardé una hora en llegar a casa.",
		"Llego en diez minutos.",
		"Se me rompió el reloj.",
	],
}

const checkChatStaysChat = (): void => {
	console.log("\nordinary sentences never hit a built-in keyword")
	for (const [language, sentences] of Object.entries(CHAT_SENTENCES))
		for (const text of sentences) {
			const found = builtinKeywordHits(
				text,
				language,
				BUILTIN_KEYWORDS[language],
			)
			checker.check(
				`${language}: "${text}" stays chat`,
				found.length === 0,
				`hit=${found.join(",")}`,
			)
		}
}

const checkExpectedTools = (): void => {
	console.log("\nonly the action tool the words name is expected to be called")
	for (const { text, expected } of EXPECTATION_CASES) {
		const hits = new Set(
			builtinKeywordHits(
				text,
				"en",
				Object.values(BUILTIN_TOOL_KEYWORDS).flat(),
			),
		)
		const found = expectedActionTools(
			BUILTIN_TOOLS,
			BUILTIN_TOOL_KEYWORDS,
			hits,
			(name) => READ_BUILTINS.has(name),
		)
		checker.check(
			`"${text}" expects [${expected.join(", ")}]`,
			found.join() === expected.map((name) => `${BUILTIN}__${name}`).join(),
			`found=${found.join(",")}`,
		)
	}
}

const checkNamedToolOnly = (): void => {
	console.log(
		"\nwhen the words name one action tool, its rivals are not offered",
	)
	const isRead = (name: string): boolean => READ_BUILTINS.has(name)
	const offeredFor = (text: string): string[] => {
		const hits = new Set(
			builtinKeywordHits(
				text,
				"en",
				Object.values(BUILTIN_TOOL_KEYWORDS).flat(),
			),
		)
		const expected = expectedActionTools(
			ALL_TOOLS,
			BUILTIN_TOOL_KEYWORDS,
			hits,
			isRead,
		)
		return namedActionToolsOnly(
			ALL_TOOLS,
			BUILTIN_TOOL_KEYWORDS,
			expected,
			isRead,
		).map((t) => t.rawName)
	}
	const remember = offeredFor("Remember that my favorite tea is jasmine.")
	checker.check(
		"remember is offered without forget, reminder, timer or alarm",
		remember.includes("remember") &&
			!["forget", "reminder", "timer", "alarm"].some((name) =>
				remember.includes(name),
			),
		remember.join(","),
	)
	checker.check(
		"read tools and other providers stay offered",
		remember.includes("time") && remember.includes("HassTurnOn"),
		remember.join(","),
	)
	checker.check(
		"a sentence that names no action tool keeps every tool",
		offeredFor("What time is it?").length === ALL_TOOLS.length,
	)
}

const main = async (): Promise<void> => {
	checkReserveRules()
	await checkDemoShortlist()
	await checkDelegatedGate()
	checkBuiltinKeywords()
	checkChatStaysChat()
	checkExpectedTools()
	checkNamedToolOnly()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} skill-routing checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
