import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
	aliasEntities,
	entityAt,
	evalCaseFileSchema,
	loadSiteMap,
	makeChecker,
	mockEntityNames,
	mockMusicPlayers,
	substitutePlaceholders,
	substituteTurn,
	turnPlaceholdersLeft,
} from "./lib"
import type { EvalCaseType, SiteEntityType, SiteMapType } from "./types"

const SITES = ["mock", "lab", "casa"]
const CASES_DIR = join(process.cwd(), "evals", "cases")
const CASE_FILE = join(CASES_DIR, "tool-scenarios.json")
const MUSIC_CASE_FILE = join(CASES_DIR, "music-scenarios.json")
const EXPECTED_GATES = 14
const EXPECTED_SCORES = 9
const MUSIC_EXPECTED_GATES = 18
const MUSIC_EXPECTED_SCORES = 6
const SITE_WORDS = ["office", "kitchen", "sconces", "pendant", "beyondtv"]
const SPEAKER_WORDS = ["living room", "voice pe", "voice_pe", "cocina", "sala"]

const checker = makeChecker()

const loadCase = (file: string): EvalCaseType => {
	const parsed = evalCaseFileSchema.parse(
		JSON.parse(readFileSync(file, "utf8")) as unknown,
	)
	const found = parsed.find((c) => c.suite === "tool-scenarios")
	if (!found) throw new Error(`no tool-scenarios case in ${file}`)
	return found
}

const runCaseFileChecks = (evalCase: EvalCaseType): void => {
	const gates = evalCase.turns.filter((t) => t.gate === true)
	const scores = evalCase.turns.filter((t) => t.gate !== true)
	checker.check(
		`case file parses with ${EXPECTED_GATES} gates`,
		gates.length === EXPECTED_GATES,
		`gates=${gates.length}`,
	)
	checker.check(
		`case file parses with ${EXPECTED_SCORES} scores`,
		scores.length === EXPECTED_SCORES,
		`scores=${scores.length}`,
	)
	checker.check(
		"every turn carries a name",
		evalCase.turns.every((t) => (t.name ?? "").length > 0),
	)
	const raw = readFileSync(CASE_FILE, "utf8").toLowerCase()
	for (const word of SITE_WORDS)
		checker.check(
			`case file holds no literal "${word}"`,
			!raw.includes(word),
			"site vocabulary belongs in evals/fixtures/sites",
		)
	checker.check(
		"case file declares a default site and an entity alias map",
		Boolean(evalCase.site) && Object.keys(evalCase.entities ?? {}).length === 3,
	)
}

const runSiteChecks = (evalCase: EvalCaseType): void => {
	for (const name of SITES) {
		const site = loadSiteMap(name)
		checker.check(
			`site ${name} defines lightA, lightB and unavailableDevice`,
			["lightA", "lightB", "unavailableDevice"].every((k) =>
				Object.hasOwn(site.entities, k),
			),
		)
		const entities = aliasEntities(site, evalCase.entities)
		const unresolved = evalCase.turns
			.map((turn) => ({
				name: turn.name ?? turn.text,
				left: turnPlaceholdersLeft(substituteTurn(turn, entities)),
			}))
			.filter((t) => t.left.length > 0)
		const hasSpanish = Boolean(entityAt(site.entities, "lightA")?.nameEs)
		const expectedUnresolved = hasSpanish ? 0 : 1
		checker.check(
			`site ${name} resolves every placeholder${hasSpanish ? "" : " but the ES twin"}`,
			unresolved.length === expectedUnresolved,
			unresolved.map((t) => `${t.name}: ${t.left.join(",")}`).join(" · "),
		)
		if (!hasSpanish)
			checker.check(
				`site ${name} leaves only nameEs unresolved`,
				unresolved.every((t) => t.left.every((p) => p.endsWith(".nameEs}}"))),
			)
	}
}

const runMockUnificationChecks = (): void => {
	const advertised = mockEntityNames().map((n) => n.toLowerCase())
	const mock = loadSiteMap("mock")
	for (const [alias, entity] of Object.entries(mock.entities))
		checker.check(
			`mock HA advertises ${alias} as "${entity.name}"`,
			advertised.includes(entity.name.toLowerCase()),
		)
	const lab = loadSiteMap("lab")
	checker.check(
		"mock site mirrors the lab entity names",
		Object.entries(lab.entities).every(
			([alias, e]) => entityAt(mock.entities, alias)?.name === e.name,
		),
	)
}

const runSubstitutionChecks = (): void => {
	const entities: Record<string, SiteEntityType> = {
		light: {
			name: "Office Lights",
			entityId: "light.office_office_main_lights",
			area: "Office",
			token: "office",
			spoken: "office lights",
		},
	}
	checker.check(
		"substitution replaces a known field",
		substitutePlaceholders("Turn on the {{entity.light.spoken}}", entities) ===
			"Turn on the office lights",
	)
	checker.check(
		"substitution leaves an unknown field intact",
		substitutePlaceholders("{{entity.light.nameEs}}", entities) ===
			"{{entity.light.nameEs}}",
	)
	checker.check(
		"substitution leaves an unknown alias intact",
		substitutePlaceholders("{{entity.other.name}}", entities) ===
			"{{entity.other.name}}",
	)
	const speakers = {
		sat: { name: "Voice PE 1", playerId: "voice_pe_1", spoken: "Voice PE 1" },
		tbd: { name: "TBD — fill me in", playerId: "TBD", spoken: "TBD" },
	}
	checker.check(
		"speaker placeholders resolve their own fields",
		substitutePlaceholders(
			"on {{speaker.sat.name}} ({{speaker.sat.playerId}})",
			entities,
			speakers,
		) === "on Voice PE 1 (voice_pe_1)",
	)
	checker.check(
		"a TBD speaker field stays unresolved so the turn skips",
		substitutePlaceholders("{{speaker.tbd.name}}", entities, speakers) ===
			"{{speaker.tbd.name}}",
	)
	const turn = substituteTurn(
		{
			text: "Which lights are on?",
			expect: {
				replyMatches: "{{entity.light.token}}",
				anyArgMatches: "{{entity.light.entityId}}",
				argsSubset: { name: "{{entity.light.name}}" },
			},
		},
		entities,
	)
	checker.check(
		"substitution reaches replyMatches, anyArgMatches and argsSubset",
		turn.expect.replyMatches === "office" &&
			turn.expect.anyArgMatches === "light.office_office_main_lights" &&
			turn.expect.argsSubset?.name === "Office Lights",
	)
}

const runMusicCaseChecks = (musicCase: EvalCaseType): void => {
	const gates = musicCase.turns.filter((t) => t.gate === true)
	const scores = musicCase.turns.filter((t) => t.gate !== true)
	checker.check(
		`music case file parses with ${MUSIC_EXPECTED_GATES} gates`,
		gates.length === MUSIC_EXPECTED_GATES,
		`gates=${gates.length}`,
	)
	checker.check(
		`music case file parses with ${MUSIC_EXPECTED_SCORES} scores`,
		scores.length === MUSIC_EXPECTED_SCORES,
		`scores=${scores.length}`,
	)
	checker.check(
		"every music turn carries a name",
		musicCase.turns.every((t) => (t.name ?? "").length > 0),
	)
	checker.check(
		"the music case declares the mock music server and a site",
		Boolean(musicCase.mockMusic) && Boolean(musicCase.site),
	)
	const raw = readFileSync(MUSIC_CASE_FILE, "utf8").toLowerCase()
	for (const word of new Set([...SPEAKER_WORDS, ...SITE_WORDS]))
		checker.check(
			`music case file holds no literal "${word}"`,
			!raw.includes(word),
			"speaker and entity vocabulary belongs in evals/fixtures/sites",
		)
	const satelliteTurns = musicCase.turns.filter((t) => t.satelliteId)
	checker.check(
		"the satellite default-player turns carry a satelliteId",
		satelliteTurns.length > 0 &&
			satelliteTurns.every(
				(t) => t.satelliteId === "{{speaker.satellite.satelliteId}}",
			),
		`turns=${satelliteTurns.length}`,
	)
}

const runMusicSiteChecks = (musicCase: EvalCaseType): void => {
	const resolvable = (site: SiteMapType): number =>
		musicCase.turns.filter(
			(turn) =>
				turnPlaceholdersLeft(
					substituteTurn(
						turn,
						aliasEntities(site, musicCase.entities),
						site.speakers,
					),
				).length === 0,
		).length
	const mock = loadSiteMap("mock")
	checker.check(
		"site mock resolves every music turn",
		resolvable(mock) === musicCase.turns.length,
		`${resolvable(mock)}/${musicCase.turns.length}`,
	)
	const casa = loadSiteMap("casa")
	checker.check(
		"site casa declares speakers but leaves them unfilled, so speaker turns skip",
		Object.keys(casa.speakers ?? {}).length > 0 &&
			resolvable(casa) < musicCase.turns.length,
		`${resolvable(casa)}/${musicCase.turns.length}`,
	)
	const lab = loadSiteMap("lab")
	checker.check("site lab declares no speakers", lab.speakers === undefined)
	const advertised = mockMusicPlayers()
	for (const [alias, speaker] of Object.entries(mock.speakers ?? {}))
		checker.check(
			`the mock music server advertises ${alias} as "${speaker.name}"`,
			advertised.some(
				(p) => p.name === speaker.name && p.playerId === speaker.playerId,
			),
			JSON.stringify(advertised),
		)
}

const main = (): void => {
	const evalCase = loadCase(CASE_FILE)
	const musicCase = loadCase(MUSIC_CASE_FILE)
	runCaseFileChecks(evalCase)
	runSiteChecks(evalCase)
	runMusicCaseChecks(musicCase)
	runMusicSiteChecks(musicCase)
	runMockUnificationChecks()
	runSubstitutionChecks()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} site-map checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

main()
