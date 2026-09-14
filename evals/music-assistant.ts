import { randomUUID } from "crypto"

import type { SelectSkillProviderType } from "@/db"
import type { DomiaType } from "@/modules/core"
import { runAgentTurn } from "@/modules/agent"
import type { AgentInferenceType } from "@/modules/agent"
import type { ToolCallOrReplyType } from "@/modules/llm-engine"
import {
	connectProvider,
	disconnectProviders,
	listTools,
	providerStatuses,
	resolveSpecializationByKind,
	resolveToolFinalize,
} from "@/modules/skill-engine"
import {
	MA_DEFAULT_TOOL_WHITELIST,
	MA_FAST_PATH_LANGUAGES,
	MA_SPECIALIZATION_KIND,
	MA_TOOL_MUSIC_PLAY,
	MA_TOOL_NOW_PLAYING,
	MA_TOOL_PAUSE,
	MA_TOOL_RESUME,
	MA_VIRTUAL_TOOLS,
} from "@/modules/skill-engine/specializations/music-assistant/constants"
import {
	implicitPlayer,
	matchPlayer,
	aliasedPlayerQuery,
	nowPlayingText,
	planPlay,
	playingText,
	queueTargetOf,
} from "@/modules/skill-engine/specializations/music-assistant/planner"
import type {
	MaPlayerType,
	MaSearchHitType,
} from "@/modules/skill-engine/specializations/music-assistant/types"
import {
	forgetPreMuteLevels,
	runVolumeViaTransport,
} from "@/modules/skill-engine/specializations/music-assistant/volume"
import { playerRoster } from "@/modules/skill-engine/specializations/music-assistant/roster"
import { lintTemplate, parseTemplate } from "@/modules/fast-path/utils/grammar"
import { matchTemplate } from "@/modules/fast-path/utils/match"
import { deleteSatellite, upsertSatellite } from "@/modules/core"
import {
	externalMediaKey,
	registerExternalMediaControls,
	unregisterExternalMediaControls,
} from "@/modules/audio-playback"
import { baseLlmModelConfig } from "@/test-utils/mocks/llm-model-config"
import { languageSetsFor, runWithTraceContext } from "@/utils"

import { env, makeChecker, queryOne, sleep, startMockMusic } from "./lib"

const checker = makeChecker()

const DOMIA_ID = randomUUID()
const DOMIA_KEY = "MUSIC_EVAL"
const SLUG = "music"

const domia = {
	id: DOMIA_ID,
	domiaKey: DOMIA_KEY,
	characterProfile: { name: "Domia", language: "en" },
	llmModelConfig: baseLlmModelConfig(DOMIA_ID),
} as unknown as DomiaType

const musicCfg = (url: string): SelectSkillProviderType =>
	({
		id: randomUUID(),
		name: "music",
		isActive: true,
		domiaId: DOMIA_ID,
		protocol: "mcp",
		type: "http",
		url,
		description: null,
		config: null,
		descriptor: { version: 1, kind: MA_SPECIALIZATION_KIND },
		auth: null,
		toolsCache: null,
		toolWhitelist: MA_DEFAULT_TOOL_WHITELIST,
		lastSyncAt: null,
		maxResultChars: 4000,
		timeout: 4000,
		toolsRefreshMs: 300_000,
		priority: 0,
		trustTier: "untrusted",
		createdAt: "",
		updatedAt: "",
	}) as unknown as SelectSkillProviderType

const player = (
	playerId: string,
	name: string,
	overrides: Partial<MaPlayerType> = {},
): MaPlayerType => ({
	playerId,
	name,
	state: "idle",
	available: true,
	volumeLevel: 40,
	muted: false,
	syncedTo: null,
	activeGroup: null,
	nowPlaying: null,
	...overrides,
})

const ROSTER = [
	player("kitchen", "Kitchen"),
	player("living_room", "Living Room"),
	player("voice_pe_1", "Voice PE 1"),
]

const GENERIC = new Set(["speaker", "speakers", "player", "music", "the"])

const hit = (
	kind: MaSearchHitType["kind"],
	name: string,
	uri: string,
	artist: string | null = null,
): MaSearchHitType => ({ kind, name, uri, artist })

const checkPlayerMatching = (): void => {
	console.log("\nspeaker names resolve the way people say them")
	checker.check(
		"an exact name wins",
		matchPlayer(ROSTER, "Kitchen", GENERIC)?.playerId === "kitchen",
		String(matchPlayer(ROSTER, "Kitchen", GENERIC)?.playerId),
	)
	checker.check(
		"a generic word after the name is ignored",
		matchPlayer(ROSTER, "kitchen speaker", GENERIC)?.playerId === "kitchen",
		String(matchPlayer(ROSTER, "kitchen speaker", GENERIC)?.playerId),
	)
	checker.check(
		"an underscored id is matched as words",
		matchPlayer(ROSTER, "living room", GENERIC)?.playerId === "living_room",
		String(matchPlayer(ROSTER, "living room", GENERIC)?.playerId),
	)
	const tied = [player("a", "Studio One"), player("b", "Studio Two")]
	checker.check(
		"a tie resolves to nothing instead of guessing",
		matchPlayer(tied, "studio", GENERIC) === null,
		String(matchPlayer(tied, "studio", GENERIC)?.name),
	)
	checker.check(
		"player alias: a spoken alias resolves to the aliased roster player",
		matchPlayer(ROSTER, "oficina", GENERIC, { oficina: "Kitchen" })
			?.playerId === "kitchen",
	)
	checker.check(
		"player alias: an unknown phrase is left untouched",
		aliasedPlayerQuery({ oficina: "Kitchen" }, "living room") === "living room",
	)
	checker.check(
		"a name nobody has does not match",
		matchPlayer(ROSTER, "garage", GENERIC) === null,
		String(matchPlayer(ROSTER, "garage", GENERIC)?.name),
	)
	checker.check(
		"only one player playing is the implicit target",
		implicitPlayer([
			player("kitchen", "Kitchen", { state: "playing" }),
			player("living_room", "Living Room"),
			player("voice_pe_1", "Voice PE 1"),
		])?.playerId === "kitchen",
	)
	checker.check(
		"three idle players leave the target undecided",
		implicitPlayer(ROSTER) === null,
	)
	checker.check(
		"a single available player is the implicit target",
		implicitPlayer([player("kitchen", "Kitchen")])?.playerId === "kitchen",
	)
	checker.check(
		"a synced player plays through the queue it follows",
		queueTargetOf(player("kitchen", "Kitchen", { syncedTo: "living_room" })) ===
			"living_room" &&
			queueTargetOf(
				player("kitchen", "Kitchen", { activeGroup: "group_1" }),
			) === "group_1" &&
			queueTargetOf(player("kitchen", "Kitchen")) === "kitchen",
	)
}

const checkPlanPlay = (): void => {
	console.log("\nthe play planner picks what the user meant")
	const hits = [
		hit("artist", "Radiohead", "spotify://artist/radiohead"),
		hit("album", "OK Computer", "spotify://album/ok-computer", "Radiohead"),
		hit("track", "Karma Police", "spotify://track/karma-police", "Radiohead"),
		hit(
			"track",
			"Paranoid Android",
			"spotify://track/paranoid-android",
			"Radiohead",
		),
	]
	checker.check(
		"an exact artist name beats the album and the tracks",
		planPlay("Radiohead", hits)?.uri === "spotify://artist/radiohead",
		String(planPlay("Radiohead", hits)?.uri),
	)
	checker.check(
		"an exact album name wins over its tracks",
		planPlay("OK Computer", hits)?.kind === "album",
		String(planPlay("OK Computer", hits)?.kind),
	)
	checker.check(
		"a song title picks the track",
		planPlay("karma police", hits)?.uri === "spotify://track/karma-police",
		String(planPlay("karma police", hits)?.uri),
	)
	checker.check(
		"a song plus its artist still picks the track",
		planPlay("karma police by radiohead", hits)?.kind === "track",
		String(planPlay("karma police by radiohead", hits)?.kind),
	)
	checker.check(
		"free text never fails closed when the server returned something",
		planPlay("something chill", [
			hit("track", "Weird Fishes", "spotify://track/weird-fishes", "Radiohead"),
		])?.kind === "track",
	)
	checker.check(
		"nothing found stays nothing found",
		planPlay("zzz nonexistent", []) === null,
	)
}

const checkSpokenText = (): void => {
	console.log("\nwhat Domia says about music, in both languages")
	const en = languageSetsFor("en").phrases
	const es = languageSetsFor("es").phrases
	const playHit = hit(
		"track",
		"Karma Police",
		"spotify://track/karma-police",
		"Radiohead",
	)
	const enPlay = playingText(en, playHit, "Kitchen")
	const esPlay = playingText(es, playHit, "Kitchen")
	checker.check(
		"the play line names the song, the artist and the speaker (en)",
		enPlay.includes("Karma Police") &&
			enPlay.includes("Radiohead") &&
			enPlay.includes("Kitchen") &&
			!enPlay.includes("{"),
		enPlay,
	)
	checker.check(
		"the play line is Spanish when the character is Spanish",
		esPlay.startsWith("Reproduciendo") && esPlay.includes("Kitchen"),
		esPlay,
	)
	const playing = player("kitchen", "Kitchen", {
		state: "playing",
		nowPlaying: {
			title: "Tití Me Preguntó",
			artist: "Bad Bunny",
			album: "Un Verano Sin Ti",
		},
	})
	checker.check(
		"now playing names the song and the speaker (en)",
		nowPlayingText(en, playing).includes("Tití Me Preguntó") &&
			nowPlayingText(en, playing).includes("Kitchen"),
		nowPlayingText(en, playing),
	)
	checker.check(
		"now playing is Spanish when the character is Spanish",
		nowPlayingText(es, playing).includes("está sonando"),
		nowPlayingText(es, playing),
	)
	checker.check(
		"an idle speaker reports silence in both languages",
		nowPlayingText(en, player("kitchen", "Kitchen")) ===
			en.musicNothingPlaying &&
			nowPlayingText(es, null) === es.musicNothingPlaying,
	)
}

const checkDescriptorInvariants = (): void => {
	console.log("\nthe shipped descriptor defaults hold together")
	const spec = resolveSpecializationByKind(MA_SPECIALIZATION_KIND)
	checker.check("the specialization is registered", spec !== null)
	if (!spec?.descriptorDefaults) return
	const allowed = [...MA_DEFAULT_TOOL_WHITELIST, ...MA_VIRTUAL_TOOLS]
	const tools = allowed.map((rawName) => ({
		provider: SLUG,
		rawName,
		namespacedName: `${SLUG}__${rawName}`,
		inputSchema: { type: "object", properties: {} },
	}))
	for (const language of ["en", "es"]) {
		const defaults = spec.descriptorDefaults(tools, language)
		const hints = defaults.execution?.toolHints ?? {}
		const missing = allowed.filter((tool) => !(tool in hints))
		checker.check(
			`every allowed tool has a hint (${language})`,
			missing.length === 0,
			missing.join(","),
		)
		checker.check(
			`coreTools stays at most two tools (${language})`,
			(defaults.execution?.coreTools ?? []).length <= 2,
			(defaults.execution?.coreTools ?? []).join(","),
		)
		const finalize = defaults.execution?.finalize ?? {}
		const unrendered = Object.entries(finalize).filter(([, rule]) =>
			[rule?.ack, rule?.done, rule?.error].some(
				(t) => typeof t === "string" && /\{(?!speakable|level)\w+\}/.test(t),
			),
		)
		checker.check(
			`every finalize template uses only known placeholders (${language})`,
			unrendered.length === 0,
			unrendered.map(([tool]) => tool).join(","),
		)
		const intents = defaults.fastPath?.intents ?? []
		const rules = defaults.fastPath?.expansionRules ?? {}
		const rejected: string[] = []
		for (const intent of intents)
			for (const template of intent.templates) {
				try {
					lintTemplate(parseTemplate(template, rules), template)
				} catch (error) {
					rejected.push(
						`${template} (${error instanceof Error ? error.message : String(error)})`,
					)
				}
			}
		checker.check(
			`every fast-path template compiles and lints (${language})`,
			intents.length > 0 && rejected.length === 0,
			rejected.join(" | "),
		)
		const declared = new Set(intents.map((i) => i.tool))
		checker.check(
			`fast path only claims allowed tools (${language})`,
			[...declared].every((tool) => allowed.includes(tool)),
			[...declared].join(","),
		)
		checker.check(
			`pause and now-playing are on the fast path (${language})`,
			declared.has(MA_TOOL_PAUSE) && declared.has(MA_TOOL_NOW_PLAYING),
			[...declared].join(","),
		)
	}
	const esFastPath = spec.descriptorDefaults(tools, "es").fastPath
	const esRules = esFastPath?.expansionRules ?? {}
	const resumeClaims = (utterance: string): boolean =>
		(esFastPath?.intents ?? [])
			.filter((intent) => intent.tool === MA_TOOL_RESUME)
			.some((intent) =>
				intent.templates.some(
					(template) =>
						matchTemplate(
							utterance,
							parseTemplate(template, esRules),
							new Map(),
						) !== null,
				),
			)
	checker.check(
		"'pon música' is a play request, never a resume (es)",
		!resumeClaims("pon música") && !resumeClaims("pon la música"),
	)
	checker.check(
		"'vuelve a poner la música' still resumes (es)",
		resumeClaims("vuelve a poner la música"),
	)
	for (const [language, pack] of Object.entries(MA_FAST_PATH_LANGUAGES)) {
		const blockers = languageSetsFor(language).fastPathBlockers
		const blocked = pack.samples.filter((sample) => {
			const tokens = new Set(sample.toLowerCase().split(/\s+/))
			return blockers.some((b) =>
				b.includes(" ") ? sample.toLowerCase().includes(b) : tokens.has(b),
			)
		})
		checker.check(
			`no fast-path sample is killed by a language blocker (${language})`,
			blocked.length === 0,
			blocked.join(" | "),
		)
	}
}

const checkArgResolution = async (): Promise<void> => {
	console.log("\nspoken arguments survive resolution")
	const spec = resolveSpecializationByKind(MA_SPECIALIZATION_KIND)
	const provider = musicCfg("http://127.0.0.1:1")
	const numeric = await spec?.resolveArgs?.(
		provider,
		MA_TOOL_MUSIC_PLAY,
		{ query: " 1999 ", player: "2" },
		"en",
	)
	checker.check(
		"a numeric-looking query and speaker stay text",
		numeric?.query === "1999" && numeric.player === "2",
		JSON.stringify(numeric),
	)
	playerRoster.attach(
		provider.id,
		rosterHandle([
			{ player_id: "eval_only", name: "Eval Only", state: "idle" },
		]),
	)
	await playerRoster.refresh(provider.id)
	const unresolved = await spec?.resolveArgs?.(
		provider,
		MA_TOOL_MUSIC_PLAY,
		{ query: "Radiohead", player: "garage" },
		"en",
	)
	const unresolvedCall = await spec?.preCall?.(
		provider,
		MA_TOOL_MUSIC_PLAY,
		unresolved ?? {},
	)
	checker.check(
		"an unknown named speaker never falls back to the default player",
		unresolvedCall?.player_id === undefined &&
			unresolvedCall?.player === "garage",
		JSON.stringify(unresolvedCall),
	)
	const targetless = await spec?.preCall?.(provider, MA_TOOL_MUSIC_PLAY, {
		query: "Radiohead",
	})
	checker.check(
		"no named speaker still fills the implicit default player",
		targetless?.player_id === "eval_only",
		JSON.stringify(targetless),
	)
	playerRoster.clear(provider.id)
}

const scripted = (steps: ToolCallOrReplyType[]): AgentInferenceType => {
	let i = 0
	return () =>
		Promise.resolve(
			steps[Math.min(i++, steps.length - 1)] ?? {
				kind: "reply",
				text: "(exhausted)",
			},
		)
}

const resultEntries = (result: {
	skillResponses: unknown[]
}): ({ tool?: string; status?: string } | undefined)[] =>
	result.skillResponses.filter(
		(e): e is { tool?: string; status?: string } =>
			e !== null && typeof e === "object" && "tool" in e,
	)

const checkLiveMock = async (): Promise<void> => {
	console.log("\nagainst a Music Assistant server (in-process mock)")
	const mock = await startMockMusic()
	const cfg = musicCfg(mock.url)
	const connected = await connectProvider(cfg, SLUG, "en")
	checker.check("the provider connects", connected)
	await sleep(300)
	const tools = await listTools({
		...domia,
		skillProviders: [cfg],
	})
	const names = tools.map((t) => t.rawName)
	checker.check(
		"both virtual tools are advertised next to the whitelisted ones",
		names.includes(MA_TOOL_MUSIC_PLAY) &&
			names.includes(MA_TOOL_NOW_PLAYING) &&
			MA_DEFAULT_TOOL_WHITELIST.every((tool) => names.includes(tool)),
		names.join(","),
	)
	checker.check(
		"nothing outside the whitelist is advertised",
		!names.includes("queue_clear_queue") &&
			!names.includes("library_search_tracks"),
		names.join(","),
	)
	const [status] = providerStatuses({
		...domia,
		skillProviders: [cfg],
	})
	checker.check(
		"the destructive queue tool never reaches the tool registry",
		!status.tools.some((t) => t.rawName === "queue_clear_queue"),
		status.tools.map((t) => t.rawName).join(","),
	)
	checker.check(
		"music_play is allowed without confirmation under untrusted",
		status.tools.find((t) => t.rawName === MA_TOOL_MUSIC_PLAY)?.policy ===
			"allow",
		JSON.stringify(status.tools.find((t) => t.rawName === MA_TOOL_MUSIC_PLAY)),
	)
	checker.check(
		"the roster reached the status block",
		(status.specialization?.players ?? 0) === 3 &&
			(status.specialization?.available ?? 0) === 3,
		JSON.stringify(status.specialization),
	)
	const playFinalize = resolveToolFinalize(
		DOMIA_ID,
		`${SLUG}__${MA_TOOL_MUSIC_PLAY}`,
	)
	const nowFinalize = resolveToolFinalize(
		DOMIA_ID,
		`${SLUG}__${MA_TOOL_NOW_PLAYING}`,
	)
	checker.check(
		"play acks on a deadline and speaks the planner result",
		playFinalize?.mode === "deadline" &&
			playFinalize.done === "{speakable}" &&
			nowFinalize?.mode === "template" &&
			nowFinalize.ack === "{speakable}",
		`${JSON.stringify(playFinalize)} ${JSON.stringify(nowFinalize)}`,
	)

	const runTurn = async (
		transcript: string,
		tool: string,
		args: Record<string, unknown>,
	): Promise<Awaited<ReturnType<typeof runAgentTurn>>> =>
		runAgentTurn(
			domia,
			transcript,
			tools,
			scripted([
				{
					kind: "tool_calls",
					calls: [{ name: `${SLUG}__${tool}`, arguments: args }],
				},
				{ kind: "reply", text: "(follow-up)" },
			]),
			{},
		)

	const nudged = await runTurn("play Radiohead", MA_TOOL_MUSIC_PLAY, {
		query: "Radiohead",
	})
	checker.check(
		"no speaker and no satellite asks which speaker instead of guessing",
		nudged.toolNamesUsed.length === 0 && nudged.reply === "(follow-up)",
		`used=${nudged.toolNamesUsed.join(",")} reply="${nudged.reply}"`,
	)

	const played = await runTurn(
		"play Radiohead on the kitchen speaker",
		MA_TOOL_MUSIC_PLAY,
		{ query: "Radiohead", player: "kitchen speaker" },
	)
	const playEntry = resultEntries(played)[0]
	checker.check(
		"a spoken speaker plays and never asks for confirmation",
		played.stopReason !== "confirm_required" &&
			played.toolNamesUsed.join(",") === `${SLUG}__${MA_TOOL_MUSIC_PLAY}` &&
			playEntry?.status === "ok",
		`stop=${played.stopReason} used=${played.toolNamesUsed.join(",")} entry=${JSON.stringify(playEntry)}`,
	)
	checker.check(
		"the spoken reply is the planner line, not a second inference",
		played.reply.includes("Radiohead") && played.reply.includes("Kitchen"),
		played.reply,
	)
	const state = await mock.state()
	checker.check(
		"the kitchen player is the one that started playing",
		state.players.find((p) => p.player_id === "kitchen")?.state === "playing" &&
			state.players.find((p) => p.player_id === "living_room")?.state ===
				"idle",
		JSON.stringify(state.players.map((p) => [p.player_id, p.state])),
	)

	const missingSpeaker = await runTurn(
		"play Radiohead in the garage",
		MA_TOOL_MUSIC_PLAY,
		{ query: "Radiohead", player: "garage" },
	)
	checker.check(
		"an unknown speaker is reported instead of playing on the default",
		resultEntries(missingSpeaker)[0]?.status === "failed" &&
			missingSpeaker.reply.includes("garage") &&
			missingSpeaker.reply.includes("not available"),
		`reply="${missingSpeaker.reply}" entries=${JSON.stringify(resultEntries(missingSpeaker))}`,
	)

	const numericQuery = await runTurn(
		"play 1999 on the kitchen speaker",
		MA_TOOL_MUSIC_PLAY,
		{ query: "1999", player: "kitchen speaker" },
	)
	checker.check(
		"a numeric title is searched for instead of asking what to play",
		numericQuery.reply.includes("1999") &&
			!numericQuery.reply.includes(
				languageSetsFor("en").phrases.musicWhichMusic,
			),
		numericQuery.reply,
	)

	const inferred = await runTurn("pause the music", MA_TOOL_PAUSE, {})
	const pauseEntry = resultEntries(inferred)[0]
	checker.check(
		"one playing speaker is inferred for a targetless control",
		inferred.toolNamesUsed.join(",") === `${SLUG}__${MA_TOOL_PAUSE}` &&
			pauseEntry?.status === "ok",
		`used=${inferred.toolNamesUsed.join(",")} entry=${JSON.stringify(pauseEntry)}`,
	)
	const paused = await mock.state()
	checker.check(
		"the inferred pause hit the kitchen queue",
		paused.players.find((p) => p.player_id === "kitchen")?.state === "paused",
		JSON.stringify(paused.players.map((p) => [p.player_id, p.state])),
	)

	const nowPlaying = await runTurn(
		"which song is this",
		MA_TOOL_NOW_PLAYING,
		{},
	)
	checker.check(
		"now playing answers with the song that is loaded",
		nowPlaying.toolNamesUsed.join(",") === `${SLUG}__${MA_TOOL_NOW_PLAYING}` &&
			resultEntries(nowPlaying)[0]?.status === "ok",
		`used=${nowPlaying.toolNamesUsed.join(",")}`,
	)

	await mock.reset()
	const noMusic = await runWithTraceContext(
		{ satelliteId: "eval-sat" },
		async () =>
			runTurn("play something nobody has", MA_TOOL_MUSIC_PLAY, {
				query: "zzqq nonexistent band",
			}),
	)
	checker.check(
		"an unknown request reports it could not be found",
		resultEntries(noMusic)[0]?.status === "failed" &&
			noMusic.reply.toLowerCase().includes("couldn't find"),
		`used=${noMusic.toolNamesUsed.join(",")} reply="${noMusic.reply}" entries=${JSON.stringify(resultEntries(noMusic))}`,
	)

	await disconnectProviders([cfg.id])
	await mock.close()
}

const TRANSPORT_SATELLITE_ID = "eval-ma-volume"
const TRANSPORT_PLAYER_NAME = "Eval Office"

const rosterHandle = (rows: Record<string, unknown>[]) =>
	({
		listTools: () => Promise.resolve({ tools: [] }),
		callTool: () =>
			Promise.resolve({
				text: "",
				status: "ok" as const,
				isError: false,
				structured: rows,
			}),
		close: () => Promise.resolve(),
	}) as unknown as Parameters<typeof playerRoster.attach>[1]

const checkTransportVolume = async (): Promise<void> => {
	console.log("\nvolume falls back to the satellite when the player has none")
	const realDomiaId = queryOne<{ id: string }>(
		"SELECT id FROM domia WHERE domia_key = ?",
		[env.EVAL_DOMIA_KEY],
	)?.id
	if (!realDomiaId) {
		checker.check("the eval identity exists in the database", false)
		return
	}
	await upsertSatellite(realDomiaId, {
		id: randomUUID(),
		satelliteId: TRANSPORT_SATELLITE_ID,
		name: "eval transport",
		protocol: "esphome",
		host: "127.0.0.1",
		port: 6053,
		isActive: false,
		mediaPlayerName: TRANSPORT_PLAYER_NAME,
	})

	const provider = {
		...musicCfg("http://127.0.0.1:1"),
		domiaId: realDomiaId,
		config: { volumeStepPercent: 10 },
	} as unknown as SelectSkillProviderType
	playerRoster.attach(
		provider.id,
		rosterHandle([
			{
				player_id: "eval_office",
				name: TRANSPORT_PLAYER_NAME,
				state: "playing",
				volume_level: null,
			},
			{
				player_id: "eval_kitchen",
				name: "Eval Kitchen",
				state: "playing",
				volume_level: 55,
			},
			{
				player_id: "eval_orphan",
				name: "Eval Orphan",
				state: "idle",
				volume_level: null,
			},
		]),
	)
	await playerRoster.refresh(provider.id)

	const mediaKey = externalMediaKey(env.EVAL_DOMIA_KEY, TRANSPORT_SATELLITE_ID)
	let level = 20
	registerExternalMediaControls(mediaKey, {
		origin: "transport",
		setVolume: (next) => {
			level = next
			return Promise.resolve(true)
		},
		getVolume: () => level,
	})

	const run = (tool: string, args: Record<string, unknown>) =>
		runVolumeViaTransport(
			provider,
			tool,
			{
				player_id: "eval_office",
				...args,
			},
			"en",
		)

	const set = await run("volume_volume_set", { level: 40 })
	checker.check(
		"a set on a level-less player is served by the satellite transport",
		set?.status === "ok" && !set.isError && level === 40,
		`${JSON.stringify(set)} level=${level}`,
	)
	checker.check(
		"the transport result carries no speakable text so the template renders",
		set?.speakableText === undefined,
	)
	await run("volume_volume_up", {})
	checker.check(
		"turn it up steps by the configured percentage",
		level === 50,
		String(level),
	)
	await run("volume_volume_down", {})
	checker.check(
		"turn it down steps back by the configured percentage",
		level === 40,
		String(level),
	)
	await run("volume_volume_mute", { muted: true })
	checker.check(
		"mute drops the satellite to silence",
		level === 0,
		String(level),
	)
	await run("volume_volume_mute", { muted: false })
	checker.check(
		"unmute restores the level the satellite had before the mute",
		level === 40,
		String(level),
	)
	forgetPreMuteLevels(provider)
	level = 70
	await run("volume_volume_mute", { muted: false })
	checker.check(
		"unmute with no remembered level keeps a louder current volume",
		level === 70,
		String(level),
	)
	level = 0
	await run("volume_volume_mute", { muted: false })
	checker.check(
		"unmute from silence with no remembered level uses the step",
		level === 10,
		String(level),
	)
	level = 40

	checker.check(
		"a player that reports its own level keeps the provider path",
		runVolumeViaTransport(
			provider,
			"volume_volume_set",
			{
				player_id: "eval_kitchen",
				level: 30,
			},
			"en",
		) === null,
	)
	checker.check(
		"a level-less player mapped to no satellite keeps the provider path",
		runVolumeViaTransport(
			provider,
			"volume_volume_set",
			{
				player_id: "eval_orphan",
				level: 30,
			},
			"en",
		) === null,
	)
	checker.check(
		"a non-volume tool is never intercepted",
		runVolumeViaTransport(
			provider,
			MA_TOOL_PAUSE,
			{
				player_id: "eval_office",
			},
			"en",
		) === null,
	)

	const spec = resolveSpecializationByKind(MA_SPECIALIZATION_KIND)
	const muteArgs = await spec?.preCall?.(provider, "volume_volume_mute", {
		player_id: "eval_office",
	})
	checker.check(
		"mute without an argument never toggles blindly",
		muteArgs?.muted === true,
		JSON.stringify(muteArgs),
	)
	const unmuteArgs = await spec?.preCall?.(provider, "volume_volume_mute", {
		player_id: "eval_office",
		muted: false,
	})
	checker.check(
		"an explicit unmute is left alone",
		unmuteArgs?.muted === false,
		JSON.stringify(unmuteArgs),
	)

	unregisterExternalMediaControls(mediaKey)
	playerRoster.clear(provider.id)
	await deleteSatellite(realDomiaId, TRANSPORT_SATELLITE_ID)
}

const main = async (): Promise<void> => {
	checkPlayerMatching()
	checkPlanPlay()
	checkSpokenText()
	checkDescriptorInvariants()
	await checkArgResolution()
	await checkTransportVolume()
	await checkLiveMock()
	console.log(
		`\n${checker.passCount()}/${checker.passCount() + checker.failCount()} music-assistant checks passed`,
	)
	process.exit(checker.failCount() === 0 ? 0 : 1)
}

void main()
