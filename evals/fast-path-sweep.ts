import { randomUUID } from "crypto"
import { writeFileSync, mkdirSync } from "fs"
import { join } from "path"

import type { DomiaType } from "@/modules/core"
import type { SelectSkillProviderType } from "@/db"
import { connectProvider, disconnectProviders } from "@/modules/skill-engine"
import { matchFastPath, invalidateFastPathIndex } from "@/modules/fast-path"
import { baseLlmModelConfig } from "@/test-utils/mocks/llm-model-config"

import { startMockHa, makeChecker } from "./lib"

const checker = makeChecker()
const BENCH_DIR = join(process.cwd(), "evals", "bench-results")

const DOMIA_ID = randomUUID()

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
		text: "turn on luz de la cocina",
		tool: "HassTurnOn",
		args: { name: "Kitchen Light" },
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
	{ text: "turn off the office lamp", class: "unknown-entity" },
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
	{ text: "Luz de la Cocina on", class: "spanglish-fragment" },
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

const haProvider = (url: string): SelectSkillProviderType =>
	({
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
		auth: null,
		toolsCache: [
			{
				provider: "home-assistant",
				rawName: "HassTurnOn",
				namespacedName: "home-assistant__HassTurnOn",
				inputSchema: {
					type: "object",
					properties: { name: { type: "string" } },
				},
			},
			{
				provider: "home-assistant",
				rawName: "HassTurnOff",
				namespacedName: "home-assistant__HassTurnOff",
				inputSchema: {
					type: "object",
					properties: { name: { type: "string" } },
				},
			},
			{
				provider: "home-assistant",
				rawName: "HassLightSet",
				namespacedName: "home-assistant__HassLightSet",
				inputSchema: {
					type: "object",
					properties: {
						name: { type: "string" },
						brightness: { type: "number" },
					},
				},
			},
		],
		toolWhitelist: null,
		lastSyncAt: null,
		maxResultChars: 4000,
		timeout: 3000,
		priority: 0,
		trustTier: "trusted",
		createdAt: "",
		updatedAt: "",
	}) as SelectSkillProviderType

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

const waitForContextFor = async (
	domia: DomiaType,
	probeText: string,
): Promise<void> => {
	for (let i = 0; i < 40; i++) {
		invalidateFastPathIndex(DOMIA_ID)
		const probe = matchFastPath(domia, probeText)
		if (probe.kind === "match") return
		await new Promise((r) => setTimeout(r, 250))
	}
}

const main = async (): Promise<void> => {
	const mock = await startMockHa(0)
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
			if (v.kind === "match") {
				fp++
				fpClasses.push(`${neg.class}: "${neg.text}"`)
			}
		}
		for (const pos of POSITIVES) {
			const v = matchFastPath(domia, pos.text)
			if (v.kind !== "match") {
				if (v.reason === "ambiguous") ambiguous++
				fn++
			} else if (v.match.tool !== pos.tool) {
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
	checker.check(
		"every generated template class is exercised by the corpus",
		templatesHit.size >= 4,
		`templates hit: ${[...templatesHit].join(" · ")}`,
	)

	const esProvider = haProvider(mock.url)
	await disconnectProviders([cfg.id])
	const esConnected = await connectProvider(esProvider, "home-assistant", "es")
	checker.check("HA provider reconnects for es", esConnected)
	const domiaEsBase = {
		...domiaAt(0.1),
		characterProfile: { language: "es" },
	} as unknown as DomiaType
	await waitForContextFor(domiaEsBase, "Enciende la luz de la cocina")
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
			if (v.kind === "match") {
				fp++
				fpClasses.push(`${neg.class}: "${neg.text}"`)
			}
		}
		for (const pos of POSITIVES_ES) {
			const v = matchFastPath(domiaEs, pos.text)
			if (v.kind !== "match") {
				if (v.reason === "ambiguous") ambiguous++
				fn++
			} else if (v.match.tool !== pos.tool) {
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
	}
	writeFileSync(
		join(BENCH_DIR, "fast-path-sweep.json"),
		JSON.stringify(artifact, null, "\t"),
	)
	const md = [
		"# Fast-path threshold sweep (offline, mock-HA entities)",
		"",
		`Run: ${artifact.timestamp} — EN ${POSITIVES.length}+/${NEGATIVES.length}- · ES ${POSITIVES_ES.length}+/${NEGATIVES_ES.length}-`,
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
