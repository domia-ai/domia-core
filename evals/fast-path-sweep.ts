import { randomUUID } from "crypto"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"

import type { DomiaType } from "@/modules/core"
import type { SelectSkillProviderType } from "@/db"
import { connectProvider, disconnectProviders } from "@/modules/skill-engine"
import { matchFastPath, invalidateFastPathIndex } from "@/modules/fast-path"
import { baseLlmModelConfig } from "@/test-utils/mocks/llm-model-config"

import {
	HA_MCP_TOOLS,
	evalCaseFileSchema,
	haToolsCacheOf,
	makeChecker,
	percentile,
	startMockHa,
	startMockMusic,
	stringOrEmpty,
} from "./lib"
import type { MockHaEntityType } from "./types"

const checker = makeChecker()
const BENCH_DIR = join(process.cwd(), "evals", "bench-results")

const DOMIA_ID = randomUUID()
const CASES_DIR = join(process.cwd(), "evals", "cases")
const FIXTURES_DIR = join(process.cwd(), "evals", "fixtures")
const HA_MEDIA_TOOL_RE = /Media|Volume/

const SWEEP_ENTITIES: MockHaEntityType[] = [
	{
		names: ["Kitchen Light", "Luz de la Cocina"],
		domain: "light",
		area: "Kitchen",
	},
	{
		names: ["Bedroom Light", "Luz del Dormitorio"],
		domain: "light",
		area: "Bedroom",
	},
	{
		names: ["Living Room Light", "Luz de la Sala"],
		domain: "light",
		area: "Living Room",
	},
	{
		names: ["Office Lights", "Luz de la Oficina"],
		domain: "light",
		area: "Office",
	},
	{ names: ["Exterior Sconces"], domain: "light", area: "Exterior" },
	{ names: ["BeyondTV"], domain: "media_player", area: "Living Room" },
	{
		names: ["Kitchen Speaker", "Kitchen"],
		domain: "media_player",
		area: "Kitchen",
	},
	{ names: ["Front Door"], domain: "lock", area: "Entryway" },
]

const POSITIVES: {
	text: string
	tool: string
	args?: Record<string, unknown>
}[] = [
	{
		text: "Turn on the kitchen light",
		tool: "HassTurnOn",
		args: { name: "Kitchen Light" },
	},
	{ text: "turn on kitchen light", tool: "HassTurnOn" },
	{
		text: "Switch on the bedroom light",
		tool: "HassTurnOn",
		args: { name: "Bedroom Light" },
	},
	{ text: "Turn the living room light on", tool: "HassTurnOn" },
	{ text: "turn on my bedroom light", tool: "HassTurnOn" },
	{
		text: "Turn off the kitchen light",
		tool: "HassTurnOff",
		args: { name: "Kitchen Light" },
	},
	{ text: "switch off bedroom light", tool: "HassTurnOff" },
	{ text: "Turn the kitchen light off", tool: "HassTurnOff" },
	{ text: "turn off the living room light", tool: "HassTurnOff" },
	{
		text: "Set the kitchen light to 40 percent",
		tool: "HassLightSet",
		args: { brightness: 40 },
	},
	{
		text: "set bedroom light to 75",
		tool: "HassLightSet",
		args: { brightness: 75 },
	},
	{
		text: "dim the living room light to 20 percent",
		tool: "HassLightSet",
		args: { brightness: 20 },
	},
	{
		text: "set the kitchen light brightness to 100",
		tool: "HassLightSet",
		args: { brightness: 100 },
	},
	{
		text: "Set the kitchen light to twenty percent",
		tool: "HassLightSet",
		args: { brightness: 20 },
	},
	{
		text: "dim the kitchen light to fifty percent",
		tool: "HassLightSet",
		args: { brightness: 50 },
	},
	{
		text: "turn on luz de la cocina",
		tool: "HassTurnOn",
		args: { name: "Kitchen Light" },
	},
	{
		text: "Luz de la Cocina on",
		tool: "HassTurnOn",
		args: { name: "Kitchen Light" },
	},
]

const COMPOUNDS: { text: string; tools: string[]; names: string[] }[] = [
	{
		text: "turn off the kitchen light and the bedroom light",
		tools: ["HassTurnOff", "HassTurnOff"],
		names: ["Kitchen Light", "Bedroom Light"],
	},
	{
		text: "turn on the kitchen light and turn off the bedroom light",
		tools: ["HassTurnOn", "HassTurnOff"],
		names: ["Kitchen Light", "Bedroom Light"],
	},
	{
		text: "switch on the living room light and the kitchen light",
		tools: ["HassTurnOn", "HassTurnOn"],
		names: ["Living Room Light", "Kitchen Light"],
	},
	{
		text: "turn on the kitchen light and the bedroom light too",
		tools: ["HassTurnOn", "HassTurnOn"],
		names: ["Kitchen Light", "Bedroom Light"],
	},
]

const ADDITIVE: { text: string; tool: string; name: string }[] = [
	{
		text: "turn on the exterior sconces as well",
		tool: "HassTurnOn",
		name: "Exterior Sconces",
	},
	{
		text: "turn off the kitchen light too",
		tool: "HassTurnOff",
		name: "Kitchen Light",
	},
	{
		text: "also turn off the bedroom light",
		tool: "HassTurnOff",
		name: "Bedroom Light",
	},
]

const ADDITIVE_ES: { text: string; tool: string; name: string }[] = [
	{
		text: "enciende también la luz de la oficina",
		tool: "HassTurnOn",
		name: "Office Lights",
	},
	{
		text: "apaga la luz del dormitorio también",
		tool: "HassTurnOff",
		name: "Bedroom Light",
	},
]

const COMPOUND_NEGATIVES: string[] = [
	"turn on the kitchen light",
	"what is the weather and the time",
]

const COMPOUNDS_ES: { text: string; tools: string[]; names: string[] }[] = [
	{
		text: "apaga la luz de la cocina y la luz del dormitorio",
		tools: ["HassTurnOff", "HassTurnOff"],
		names: ["Kitchen Light", "Bedroom Light"],
	},
	{
		text: "enciende la luz de la sala y apaga la luz de la cocina",
		tools: ["HassTurnOn", "HassTurnOff"],
		names: ["Living Room Light", "Kitchen Light"],
	},
]

const NEGATIVES: { text: string; class: string }[] = [
	{ text: "Don't turn on the kitchen light", class: "negation" },
	{ text: "do not turn off the bedroom light", class: "negation" },
	{ text: "never turn on the living room light", class: "negation" },
	{ text: "please don't switch off the kitchen light", class: "negation" },
	{ text: "I already turned on the kitchen light", class: "past" },
	{ text: "I turned off the bedroom light earlier", class: "past" },
	{ text: "the kitchen light was on yesterday", class: "past" },
	{ text: "I'll turn on the kitchen light later", class: "future" },
	{ text: "remind me to turn off the bedroom light tomorrow", class: "future" },
	{ text: "Did you turn on the kitchen light", class: "question" },
	{ text: "why is the kitchen light on", class: "question" },
	{ text: "when did the bedroom light turn off", class: "question" },
	{ text: "can you turn on lights in general", class: "capability-question" },
	{
		text: "would you turn on the kitchen light if I asked",
		class: "hypothetical",
	},
	{
		text: "if you turn on the kitchen light it gets warm",
		class: "hypothetical",
	},
	{ text: "imagine you turn off the bedroom light", class: "hypothetical" },
	{ text: "suppose the kitchen light is on", class: "hypothetical" },
	{ text: "she said turn on the kitchen light", class: "reported" },
	{ text: "my mom told me to turn off the bedroom light", class: "reported" },
	{ text: "he asked me to turn on the living room light", class: "reported" },
	{
		text: "so my grandma used to turn on the kitchen light every morning before breakfast",
		class: "ramble",
	},
	{ text: "there is a song called turn off the light", class: "ramble" },
	{
		text: "turning on the kitchen light is something I enjoy",
		class: "ramble",
	},
	{ text: "the movie turn on the bedroom light was great", class: "ramble" },
	{ text: "Turn on the garage light", class: "unknown-entity" },
	{ text: "turn off the garage lamp", class: "unknown-entity" },
	{ text: "set the porch light to 50 percent", class: "unknown-entity" },
	{ text: "Kitchen light", class: "bare-name" },
	{ text: "the bedroom light", class: "bare-name" },
	{ text: "lights", class: "bare-name" },
	{ text: "turn on", class: "bare-verb" },
	{ text: "switch off", class: "bare-verb" },
	{ text: "set the kitchen light to 400 percent", class: "out-of-range" },
	{
		text: "turn on the kitchen light and tell me a story about pirates",
		class: "compound",
	},
	{
		text: "turn on the kitchen light when the sun goes down",
		class: "conditional",
	},
	{ text: "turn off the bedroom light in ten minutes", class: "deferred" },
	{ text: "what do you think about the kitchen light", class: "opinion" },
	{ text: "I love the light of the sunset", class: "chat" },
	{ text: "a house full of lights sounds cozy", class: "chat" },
	{ text: "how are you today", class: "chat" },
	{ text: "who turned on the kitchen light", class: "question" },
	{
		text: "could you maybe turn on the kitchen light sometime",
		class: "hedged",
	},
	{ text: "should I turn off the bedroom light", class: "question" },
	{
		text: "my neighbor turns on the kitchen light every night",
		class: "third-party",
	},
	{ text: "turning off lights saves energy", class: "chat" },
	{ text: "the kitchen light", class: "bare-name" },
	{
		text: "what happens if I turn off the bedroom light",
		class: "hypothetical",
	},
	{ text: "I was about to turn on the living room light", class: "past" },
	{
		text: "don't ever switch on the bedroom light at night",
		class: "negation",
	},
	{ text: "turn on the kitchen light or maybe not", class: "hedged" },
	{
		text: "she turns the kitchen light on when she cooks",
		class: "third-party",
	},
]

const POSITIVES_ES: {
	text: string
	tool: string
	args?: Record<string, unknown>
}[] = [
	{
		text: "Enciende la luz de la cocina",
		tool: "HassTurnOn",
		args: { name: "Kitchen Light" },
	},
	{ text: "enciende luz de la cocina", tool: "HassTurnOn" },
	{
		text: "prende la luz del dormitorio",
		tool: "HassTurnOn",
		args: { name: "Bedroom Light" },
	},
	{
		text: "activa la luz de la sala",
		tool: "HassTurnOn",
		args: { name: "Living Room Light" },
	},
	{
		text: "apaga la luz de la cocina",
		tool: "HassTurnOff",
		args: { name: "Kitchen Light" },
	},
	{ text: "Apaga la luz del dormitorio", tool: "HassTurnOff" },
	{ text: "desactiva la luz de la sala", tool: "HassTurnOff" },
	{
		text: "pon la luz de la cocina al 40",
		tool: "HassLightSet",
		args: { brightness: 40 },
	},
	{
		text: "ajusta la luz del dormitorio al 75 por ciento",
		tool: "HassLightSet",
		args: { brightness: 75 },
	},
	{
		text: "pon la luz de la sala al 20 por ciento",
		tool: "HassLightSet",
		args: { brightness: 20 },
	},
]

const NEGATIVES_ES: { text: string; class: string }[] = [
	{ text: "no enciendas la luz de la cocina", class: "negation" },
	{ text: "no apagues la luz del dormitorio", class: "negation" },
	{ text: "nunca enciendas la luz de la sala", class: "negation" },
	{ text: "jamás apagues la luz de la cocina", class: "negation" },
	{ text: "ya encendí la luz de la cocina", class: "past" },
	{ text: "ayer apagué la luz del dormitorio", class: "past" },
	{ text: "la luz de la cocina estaba encendida", class: "past" },
	{ text: "luego enciendo la luz de la sala", class: "future" },
	{ text: "mañana apago la luz del dormitorio", class: "future" },
	{ text: "por qué está encendida la luz de la cocina", class: "question" },
	{ text: "cuándo se apagó la luz del dormitorio", class: "question" },
	{ text: "quién encendió la luz de la sala", class: "question" },
	{ text: "puedes encender luces en general", class: "capability-question" },
	{
		text: "podrías encender la luz de la cocina si te lo pido",
		class: "hypothetical",
	},
	{
		text: "si enciendes la luz de la cocina se calienta",
		class: "hypothetical",
	},
	{ text: "imagina que apagas la luz del dormitorio", class: "hypothetical" },
	{
		text: "supón que la luz de la cocina está encendida",
		class: "hypothetical",
	},
	{ text: "ella dijo enciende la luz de la cocina", class: "reported" },
	{
		text: "mi mamá me contó que apagó la luz del dormitorio",
		class: "reported",
	},
	{ text: "me preguntó si enciendo la luz de la sala", class: "reported" },
	{
		text: "mi abuela encendía la luz de la cocina cada mañana antes del desayuno",
		class: "ramble",
	},
	{ text: "hay una canción que se llama apaga la luz", class: "ramble" },
	{
		text: "encender la luz de la cocina es algo que disfruto",
		class: "ramble",
	},
	{ text: "enciende la luz del garaje", class: "unknown-entity" },
	{ text: "apaga la lámpara de la oficina", class: "unknown-entity" },
	{ text: "pon la luz del patio al 50", class: "unknown-entity" },
	{ text: "la luz de la cocina", class: "bare-name" },
	{ text: "luz del dormitorio", class: "bare-name" },
	{ text: "las luces", class: "bare-name" },
	{ text: "enciende", class: "bare-verb" },
	{ text: "apaga", class: "bare-verb" },
	{ text: "pon la luz de la cocina al 400", class: "out-of-range" },
	{
		text: "enciende la luz de la cocina y cuéntame un cuento de piratas",
		class: "compound",
	},
	{
		text: "enciende la luz de la cocina cuando se ponga el sol",
		class: "conditional",
	},
	{
		text: "apaga la luz del dormitorio ya mismo por favor te lo pido",
		class: "filler-heavy",
	},
	{ text: "qué opinas de la luz de la cocina", class: "opinion" },
	{ text: "me encanta la luz del atardecer", class: "chat" },
	{ text: "una casa llena de luces suena acogedora", class: "chat" },
	{ text: "cómo estás hoy", class: "chat" },
]

const HA_MEDIA_KEEPS: { text: string; tool: string; name: string }[] = [
	{ text: "turn off the BeyondTV", tool: "HassTurnOff", name: "BeyondTV" },
	{
		text: "turn off the kitchen speaker",
		tool: "HassTurnOff",
		name: "Kitchen Speaker",
	},
]

const HA_MEDIA_NEGATIVES: string[] = ["turn off the kitchen speaker"]

const SKIP_WORD_POSITIVES: {
	text: string
	tool: string
	args: Record<string, unknown>
}[] = [
	{
		text: "please turn on the kitchen light",
		tool: "HassTurnOn",
		args: { name: "Kitchen Light" },
	},
	{
		text: "could you turn off the bedroom light",
		tool: "HassTurnOff",
		args: { name: "Bedroom Light" },
	},
	{
		text: "turn on the kitchen light please",
		tool: "HassTurnOn",
		args: { name: "Kitchen Light" },
	},
	{
		text: "can you set the kitchen light to 40 percent for me",
		tool: "HassLightSet",
		args: { name: "Kitchen Light", brightness: 40 },
	},
]

const SKIP_WORD_NEGATIVES: string[] = [
	"for me the kitchen light is too bright",
	"please explain how the kitchen light works",
	"i want to know if the kitchen light is on",
]

const SKIP_WORD_POSITIVES_ES: {
	text: string
	tool: string
	args: Record<string, unknown>
}[] = [
	{
		text: "por favor enciende la luz de la cocina",
		tool: "HassTurnOn",
		args: { name: "Kitchen Light" },
	},
	{
		text: "apaga la luz del dormitorio por favor",
		tool: "HassTurnOff",
		args: { name: "Bedroom Light" },
	},
	{
		text: "podrías apagar la luz de la cocina",
		tool: "HassTurnOff",
		args: { name: "Kitchen Light" },
	},
	{
		text: "puedes encender la luz de la sala",
		tool: "HassTurnOn",
		args: { name: "Living Room Light" },
	},
	{
		text: "me puedes prender la luz del dormitorio",
		tool: "HassTurnOn",
		args: { name: "Bedroom Light" },
	},
]

const SKIP_WORD_NEGATIVES_ES: string[] = [
	"por favor dime si la luz de la cocina está encendida",
	"gracias por encender la luz de la cocina",
]

const chatExpectedTexts = (language: string): string[] => {
	const files = [
		join(CASES_DIR, "chat-negatives.json"),
		join(CASES_DIR, "fast-negatives-en.json"),
		join(CASES_DIR, "routing-en.json"),
		join(FIXTURES_DIR, "routing-es.json"),
	]
	const out: string[] = []
	for (const file of files) {
		const cases = evalCaseFileSchema.parse(
			JSON.parse(readFileSync(file, "utf8")),
		)
		const allTurnsAreChat = !file.includes("routing")
		for (const c of cases) {
			if (c.language !== language) continue
			for (const turn of c.turns)
				if (allTurnsAreChat || turn.expect.routed === "chat")
					out.push(turn.text)
		}
	}
	return [...new Set(out)]
}

const haProvider = (url: string): SelectSkillProviderType => ({
	id: randomUUID(),
	name: "home-assistant",
	isActive: true,
	domiaId: DOMIA_ID,
	protocol: "mcp",
	type: "http",
	url,
	description: null,
	config: null,
	descriptor: { version: 1, kind: "home-assistant" },
	serverDescriptor: null,
	serverDescriptorHash: null,
	auth: null,
	toolsCache: haToolsCacheOf(HA_MCP_TOOLS),
	toolWhitelist: null,
	lastSyncAt: null,
	maxResultChars: 4000,
	timeout: 3000,
	toolsRefreshMs: 300_000,
	priority: 0,
	trustTier: "trusted",
	createdAt: "",
	updatedAt: "",
})

const MUSIC_TOOLS: { rawName: string; properties: Record<string, unknown> }[] =
	[
		{ rawName: "playback_pause", properties: { queue_id: { type: "string" } } },
		{
			rawName: "playback_resume",
			properties: { queue_id: { type: "string" } },
		},
		{
			rawName: "playback_next_track",
			properties: { queue_id: { type: "string" } },
		},
		{
			rawName: "playback_previous_track",
			properties: { queue_id: { type: "string" } },
		},
		{
			rawName: "volume_volume_set",
			properties: {
				player_id: { type: "string" },
				level: { type: "number" },
			},
		},
		{
			rawName: "volume_volume_up",
			properties: { player_id: { type: "string" } },
		},
		{
			rawName: "volume_volume_down",
			properties: { player_id: { type: "string" } },
		},
		{
			rawName: "volume_volume_mute",
			properties: {
				player_id: { type: "string" },
				muted: { type: "boolean" },
			},
		},
		{ rawName: "music_play", properties: { query: { type: "string" } } },
		{
			rawName: "music_now_playing",
			properties: { player: { type: "string" } },
		},
	]

const musicProvider = (url: string): SelectSkillProviderType =>
	({
		...haProvider(url),
		id: randomUUID(),
		name: "music",
		descriptor: { version: 1, kind: "music-assistant" },
		trustTier: "untrusted",
		priority: 1,
		toolsCache: MUSIC_TOOLS.map((tool) => ({
			provider: "music",
			rawName: tool.rawName,
			namespacedName: `music__${tool.rawName}`,
			inputSchema: { type: "object", properties: tool.properties },
		})),
	}) as unknown as SelectSkillProviderType

const MUSIC_POSITIVES: { text: string; tool: string }[] = [
	{ text: "pause the music", tool: "playback_pause" },
	{ text: "stop the song", tool: "playback_pause" },
	{ text: "next song", tool: "playback_next_track" },
	{ text: "turn the volume down", tool: "volume_volume_down" },
	{ text: "set the volume to 40 percent", tool: "volume_volume_set" },
	{ text: "which song is this", tool: "music_now_playing" },
	{ text: "mute the speakers", tool: "volume_volume_mute" },
]

const MUSIC_SLOT_POSITIVES: { text: string; tool: string; playerId: string }[] =
	[
		{
			text: "mute the kitchen",
			tool: "volume_volume_mute",
			playerId: "kitchen",
		},
		{
			text: "pause the music in the living room",
			tool: "playback_pause",
			playerId: "living_room",
		},
	]

const MUSIC_NEGATIVES: { text: string; class: string }[] = [
	{ text: "stop talking", class: "stop-word" },
	{ text: "play it cool", class: "idiom" },
	{ text: "I love this song", class: "chat" },
	{ text: "turn off the lights", class: "home-vocabulary" },
]

const HA_KEEPS: { text: string; tool: string }[] = [
	{ text: "turn off the kitchen light", tool: "HassTurnOff" },
	{ text: "turn on the bedroom light", tool: "HassTurnOn" },
]

const domiaAt = (minCoverage: number): DomiaType =>
	({
		id: DOMIA_ID,
		domiaKey: "SWEEP",
		characterProfile: { language: "en" },
		llmModelConfig: {
			...baseLlmModelConfig(DOMIA_ID),
			fastPathEnabled: true,
			fastPathMinCoverage: minCoverage,
		},
	}) as unknown as DomiaType

const waitUntil = async (
	domia: DomiaType,
	probeText: string,
	expected: "match" | "miss",
): Promise<void> => {
	for (let i = 0; i < 40; i++) {
		invalidateFastPathIndex(DOMIA_ID)
		const probe = matchFastPath(domia, probeText)
		if (probe.kind === expected) return
		await new Promise((r) => setTimeout(r, 250))
	}
}

const waitForContextFor = (
	domia: DomiaType,
	probeText: string,
): Promise<void> => waitUntil(domia, probeText, "match")

const timings: number[] = []

const timedMatch = (
	domia: DomiaType,
	text: string,
): ReturnType<typeof matchFastPath> => {
	const v = matchFastPath(domia, text)
	timings.push(v.fastPathMs)
	return v
}

const checkSkipWords = (
	domia: DomiaType,
	label: string,
	positives: { text: string; tool: string; args: Record<string, unknown> }[],
	negatives: string[],
): void => {
	for (const pos of positives) {
		const v = timedMatch(domia, pos.text)
		const ok =
			v.kind === "match" &&
			v.match.tool === pos.tool &&
			Object.entries(pos.args).every(
				([k, val]) => v.match.resolvedArgs[k] === val,
			)
		checker.check(
			`${label} skip words: "${pos.text}" → ${pos.tool}`,
			ok,
			`kind=${v.kind} ${v.kind === "match" ? `${v.match.tool} ${JSON.stringify(v.match.resolvedArgs)}` : v.kind === "miss" ? v.reason : ""}`,
		)
	}
	for (const neg of negatives) {
		const v = timedMatch(domia, neg)
		checker.check(
			`${label} skip words never unlock chat: "${neg}"`,
			v.kind === "miss",
			`kind=${v.kind} ${v.kind === "match" ? v.match.tool : ""}`,
		)
	}
}

const checkChatRatchet = (domia: DomiaType, language: string): void => {
	const texts = chatExpectedTexts(language)
	const hits = texts.flatMap((text) => {
		const v = timedMatch(domia, text)
		return v.kind === "miss"
			? []
			: [`"${text}" → ${v.kind === "match" ? v.match.tool : "compound"}`]
	})
	checker.check(
		`${language} chat ratchet: ${texts.length} chat-expected turns never fast-path`,
		hits.length === 0,
		hits.slice(0, 5).join(" | "),
	)
}

const main = async (): Promise<void> => {
	const mock = await startMockHa(
		0,
		{},
		{ entities: SWEEP_ENTITIES, tools: HA_MCP_TOOLS },
	)
	const cfg = haProvider(mock.url)
	const connected = await connectProvider(cfg, "home-assistant", "en")
	checker.check("HA provider connects", connected)
	await waitForContextFor(domiaAt(0.1), "Turn on the kitchen light")

	const grid: {
		threshold: number
		falsePositives: number
		falseNegatives: number
		ambiguous: number
		fpClasses: string[]
	}[] = []
	for (let t = 0; t <= 0.6; t += 0.05) {
		const threshold = Math.round(t * 100) / 100
		const domia = domiaAt(threshold)
		let fp = 0
		let fn = 0
		let ambiguous = 0
		const fpClasses: string[] = []
		for (const neg of NEGATIVES) {
			const v = matchFastPath(domia, neg.text)
			if (v.kind !== "miss") {
				fp++
				fpClasses.push(`${neg.class}: "${neg.text}"`)
			}
		}
		for (const pos of POSITIVES) {
			const v = matchFastPath(domia, pos.text)
			if (v.kind === "miss") {
				if (v.reason === "ambiguous") ambiguous++
				fn++
			} else if (v.kind === "compound" || v.match.tool !== pos.tool) {
				fn++
			}
		}
		grid.push({
			threshold,
			falsePositives: fp,
			falseNegatives: fn,
			ambiguous,
			fpClasses,
		})
	}

	const defaultRow = grid.find((g) => g.threshold === 0.1)
	checker.check(
		"zero false positives at the default threshold (0.10)",
		defaultRow?.falsePositives === 0,
		defaultRow?.fpClasses.join(" | ") ?? "",
	)
	checker.check(
		"zero false negatives at the default threshold (0.10)",
		defaultRow?.falseNegatives === 0,
		`fn=${defaultRow?.falseNegatives}`,
	)

	const domia = domiaAt(0.1)
	const templatesHit = new Set<string>()
	for (const pos of POSITIVES) {
		const v = matchFastPath(domia, pos.text)
		if (v.kind === "match") templatesHit.add(v.match.template)
		if (pos.args) {
			const ok =
				v.kind === "match" &&
				Object.entries(pos.args).every(
					([k, val]) => v.match.resolvedArgs[k] === val,
				)
			checker.check(`args resolve for "${pos.text}"`, ok)
		}
	}
	for (const compound of COMPOUNDS) {
		const v = matchFastPath(domia, compound.text)
		const tools = v.kind === "compound" ? v.matches.map((m) => m.tool) : []
		const names =
			v.kind === "compound"
				? v.matches.map((m) => stringOrEmpty(m.resolvedArgs.name))
				: []
		checker.check(
			`compound splits "${compound.text}"`,
			v.kind === "compound" &&
				tools.join(",") === compound.tools.join(",") &&
				names.join(",") === compound.names.join(","),
			`kind=${v.kind} tools=${tools.join(",")} names=${names.join(",")}`,
		)
	}
	for (const single of COMPOUND_NEGATIVES) {
		const v = matchFastPath(domia, single)
		checker.check(
			`no compound split for "${single}"`,
			v.kind !== "compound",
			`kind=${v.kind}`,
		)
	}
	for (const additive of ADDITIVE) {
		const v = matchFastPath(domia, additive.text)
		checker.check(
			`additive cue keeps one target for "${additive.text}"`,
			v.kind === "match" &&
				v.match.tool === additive.tool &&
				stringOrEmpty(v.match.resolvedArgs.name) === additive.name,
			`kind=${v.kind} ${v.kind === "match" ? JSON.stringify(v.match.resolvedArgs) : ""}`,
		)
	}

	checker.check(
		"every generated template class is exercised by the corpus",
		templatesHit.size >= 4,
		`templates hit: ${[...templatesHit].join(" · ")}`,
	)
	for (const keep of HA_MEDIA_KEEPS) {
		const v = timedMatch(domia, keep.text)
		checker.check(
			`without music assistant a media_player is a device: "${keep.text}" → ${keep.tool}`,
			v.kind === "match" &&
				v.match.tool === keep.tool &&
				!HA_MEDIA_TOOL_RE.test(v.match.tool) &&
				stringOrEmpty(v.match.resolvedArgs.name) === keep.name,
			`kind=${v.kind} ${v.kind === "match" ? `${v.match.tool} ${JSON.stringify(v.match.resolvedArgs)}` : ""}`,
		)
	}
	checkSkipWords(domia, "en", SKIP_WORD_POSITIVES, SKIP_WORD_NEGATIVES)

	const music = await startMockMusic()
	const musicCfg = musicProvider(music.url)
	const musicConnected = await connectProvider(musicCfg, "music", "en")
	checker.check(
		"music provider connects alongside home-assistant",
		musicConnected,
	)
	await waitForContextFor(domiaAt(0.1), "mute the kitchen")
	const bothDomia = domiaAt(0.1)
	for (const neg of HA_MEDIA_NEGATIVES) await waitUntil(bothDomia, neg, "miss")
	for (const neg of HA_MEDIA_NEGATIVES) {
		const v = timedMatch(bothDomia, neg)
		checker.check(
			`with music assistant its player is not an HA device: "${neg}" takes no HA template`,
			v.kind !== "compound" &&
				(v.kind === "miss" || v.match.providerSlug !== "home-assistant"),
			`kind=${v.kind} ${v.kind === "match" ? `${v.match.tool} ${JSON.stringify(v.match.resolvedArgs)}` : ""}`,
		)
	}
	{
		const tv = HA_MEDIA_KEEPS[0]
		const v = timedMatch(bothDomia, tv.text)
		checker.check(
			`with music assistant the TV stays an HA device: "${tv.text}" → ${tv.tool}`,
			v.kind === "match" &&
				v.match.tool === tv.tool &&
				stringOrEmpty(v.match.resolvedArgs.name) === tv.name,
			`kind=${v.kind} ${v.kind === "match" ? `${v.match.tool} ${JSON.stringify(v.match.resolvedArgs)}` : ""}`,
		)
	}
	checkChatRatchet(bothDomia, "en")
	for (const pos of MUSIC_POSITIVES) {
		const v = matchFastPath(bothDomia, pos.text)
		checker.check(
			`music fast path: "${pos.text}" → ${pos.tool}`,
			v.kind === "match" && v.match.tool === pos.tool,
			`kind=${v.kind} tool=${v.kind === "match" ? v.match.tool : ""}`,
		)
	}
	for (const slot of MUSIC_SLOT_POSITIVES) {
		const v = matchFastPath(bothDomia, slot.text)
		const args = v.kind === "match" ? v.match.resolvedArgs : {}
		checker.check(
			`music roster slot: "${slot.text}" → ${slot.tool} on ${slot.playerId}`,
			v.kind === "match" &&
				v.match.tool === slot.tool &&
				Object.values(args).includes(slot.playerId),
			`kind=${v.kind} tool=${v.kind === "match" ? v.match.tool : ""} args=${JSON.stringify(args)}`,
		)
	}
	for (const neg of MUSIC_NEGATIVES) {
		const v = matchFastPath(bothDomia, neg.text)
		const tool = v.kind === "match" ? v.match.tool : ""
		checker.check(
			`music negative (${neg.class}): "${neg.text}" takes no music tool`,
			!MUSIC_TOOLS.some((t) => t.rawName === tool),
			`kind=${v.kind} tool=${tool}`,
		)
	}
	for (const keep of HA_KEEPS) {
		const v = matchFastPath(bothDomia, keep.text)
		checker.check(
			`home-assistant keeps "${keep.text}" → ${keep.tool}`,
			v.kind === "match" && v.match.tool === keep.tool,
			`kind=${v.kind} tool=${v.kind === "match" ? v.match.tool : ""}`,
		)
	}
	await disconnectProviders([musicCfg.id])
	invalidateFastPathIndex(DOMIA_ID)

	const esProvider = haProvider(mock.url)
	await disconnectProviders([cfg.id])
	const esConnected = await connectProvider(esProvider, "home-assistant", "es")
	checker.check("HA provider reconnects for es", esConnected)
	const domiaEsBase = {
		...domiaAt(0.1),
		characterProfile: { language: "es" },
	} as unknown as DomiaType
	await waitForContextFor(domiaEsBase, "Enciende la luz de la cocina")
	const musicEsCfg = musicProvider(music.url)
	const musicEsConnected = await connectProvider(musicEsCfg, "music", "es")
	checker.check(
		"music provider connects alongside home-assistant (es)",
		musicEsConnected,
	)
	await waitUntil(domiaEsBase, "apaga el kitchen speaker", "miss")
	const gridEs: typeof grid = []
	for (let t = 0; t <= 0.6; t += 0.05) {
		const threshold = Math.round(t * 100) / 100
		const domiaEs = {
			...domiaAt(threshold),
			characterProfile: { language: "es" },
		} as unknown as DomiaType
		let fp = 0
		let fn = 0
		let ambiguous = 0
		const fpClasses: string[] = []
		for (const neg of NEGATIVES_ES) {
			const v = matchFastPath(domiaEs, neg.text)
			if (v.kind !== "miss") {
				fp++
				fpClasses.push(`${neg.class}: "${neg.text}"`)
			}
		}
		for (const pos of POSITIVES_ES) {
			const v = matchFastPath(domiaEs, pos.text)
			if (v.kind === "miss") {
				if (v.reason === "ambiguous") ambiguous++
				fn++
			} else if (v.kind === "compound" || v.match.tool !== pos.tool) {
				fn++
			}
		}
		gridEs.push({
			threshold,
			falsePositives: fp,
			falseNegatives: fn,
			ambiguous,
			fpClasses,
		})
	}
	const defaultRowEs = gridEs.find((g) => g.threshold === 0.1)
	checker.check(
		"es: zero false positives at the default threshold",
		defaultRowEs?.falsePositives === 0,
		defaultRowEs?.fpClasses.join(" | ") ?? "",
	)
	checker.check(
		"es: zero false negatives at the default threshold",
		defaultRowEs?.falseNegatives === 0,
		`fn=${defaultRowEs?.falseNegatives}`,
	)
	const domiaEs = {
		...domiaAt(0.1),
		characterProfile: { language: "es" },
	} as unknown as DomiaType
	for (const pos of POSITIVES_ES) {
		if (!pos.args) continue
		const v = matchFastPath(domiaEs, pos.text)
		const ok =
			v.kind === "match" &&
			Object.entries(pos.args).every(
				([k, val]) => v.match.resolvedArgs[k] === val,
			)
		checker.check(`es args resolve for "${pos.text}"`, ok)
	}
	for (const compound of COMPOUNDS_ES) {
		const v = matchFastPath(domiaEs, compound.text)
		const tools = v.kind === "compound" ? v.matches.map((m) => m.tool) : []
		const names =
			v.kind === "compound"
				? v.matches.map((m) => stringOrEmpty(m.resolvedArgs.name))
				: []
		checker.check(
			`es compound splits "${compound.text}"`,
			v.kind === "compound" &&
				tools.join(",") === compound.tools.join(",") &&
				names.join(",") === compound.names.join(","),
			`kind=${v.kind} tools=${tools.join(",")} names=${names.join(",")}`,
		)
	}

	for (const additive of ADDITIVE_ES) {
		const v = matchFastPath(domiaEs, additive.text)
		checker.check(
			`es additive cue keeps one target for "${additive.text}"`,
			v.kind === "match" &&
				v.match.tool === additive.tool &&
				stringOrEmpty(v.match.resolvedArgs.name) === additive.name,
			`kind=${v.kind} ${v.kind === "match" ? JSON.stringify(v.match.resolvedArgs) : ""}`,
		)
	}
	checkSkipWords(domiaEs, "es", SKIP_WORD_POSITIVES_ES, SKIP_WORD_NEGATIVES_ES)
	checkChatRatchet(domiaEs, "es")
	await disconnectProviders([musicEsCfg.id])
	await music.close()

	mkdirSync(BENCH_DIR, { recursive: true })
	const artifact = {
		timestamp: new Date().toISOString(),
		en: { positives: POSITIVES.length, negatives: NEGATIVES.length },
		es: { positives: POSITIVES_ES.length, negatives: NEGATIVES_ES.length },
		grid: grid.map(({ fpClasses, ...row }) => ({
			...row,
			fpSample: fpClasses.slice(0, 3),
		})),
		gridEs: gridEs.map(({ fpClasses, ...row }) => ({
			...row,
			fpSample: fpClasses.slice(0, 3),
		})),
		fastPathMs: {
			n: timings.length,
			p50: percentile(timings, 50),
			p95: percentile(timings, 95),
		},
	}
	writeFileSync(
		join(BENCH_DIR, "fast-path-sweep.json"),
		JSON.stringify(artifact, null, "\t"),
	)
	const md = [
		"# Fast-path threshold sweep (offline, mock-HA entities)",
		"",
		`Run: ${artifact.timestamp} — EN ${POSITIVES.length}+/${NEGATIVES.length}- · ES ${POSITIVES_ES.length}+/${NEGATIVES_ES.length}- · fastPathMs p50 ${artifact.fastPathMs.p50} / p95 ${artifact.fastPathMs.p95} (n=${artifact.fastPathMs.n})`,
		"",
		"## EN",
		"| coverage ≥ | false positives | false negatives | ambiguous |",
		"|---|---|---|---|",
		...grid.map(
			(g) =>
				`| ${g.threshold.toFixed(2)} | ${g.falsePositives} | ${g.falseNegatives} | ${g.ambiguous} |`,
		),
		"",
		"## ES",
		"| coverage ≥ | false positives | false negatives | ambiguous |",
		"|---|---|---|---|",
		...gridEs.map(
			(g) =>
				`| ${g.threshold.toFixed(2)} | ${g.falsePositives} | ${g.falseNegatives} | ${g.ambiguous} |`,
		),
	].join("\n")
	writeFileSync(join(BENCH_DIR, "fast-path-sweep.md"), md)
	console.log(`\n${md}`)

	await disconnectProviders([cfg.id])
	await mock.close()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} fast-path sweep checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
