import { MCP_TRANSPORT_ENUM, SKILL_PROTOCOL_ENUM } from "@/db"
import { resolveSkillAdapter } from "@/modules/skill-engine"
import type { SkillConnHandleType } from "@/modules/skill-engine"
import { getSkillProvider } from "@/test-utils"

import { makeChecker, startMockMusic, startPlainMcp } from "./lib"
import type { MockMusicServerType, MockMusicTrackType } from "./types"

const checker = makeChecker()

const connect = async (url: string): Promise<SkillConnHandleType> => {
	const adapter = resolveSkillAdapter(
		SKILL_PROTOCOL_ENUM.MCP,
		MCP_TRANSPORT_ENUM.HTTP,
	)
	if (!adapter) throw new Error("no v2 adapter registered for http")
	return adapter.connect(
		getSkillProvider({
			name: "eval-mock-music",
			protocol: SKILL_PROTOCOL_ENUM.MCP,
			type: MCP_TRANSPORT_ENUM.HTTP,
			url,
			timeout: 5000,
		}),
		{},
	)
}

const resultList = (structured: unknown): Record<string, unknown>[] => {
	const wrapped = (structured ?? {}) as { result?: unknown }
	return Array.isArray(wrapped.result)
		? (wrapped.result as Record<string, unknown>[])
		: []
}

const resultObject = (structured: unknown): Record<string, unknown> => {
	const wrapped = (structured ?? {}) as { result?: unknown }
	return typeof wrapped.result === "object" && wrapped.result !== null
		? (wrapped.result as Record<string, unknown>)
		: {}
}

const EXPECTED_TOOLS = [
	"library_search_tracks",
	"library_search_albums",
	"library_search_artists",
	"players_list_players",
	"players_get_player",
	"playback_play_media",
	"playback_pause",
	"playback_resume",
	"playback_play_pause",
	"playback_stop",
	"playback_next_track",
	"playback_previous_track",
	"queue_get_active_queue",
	"queue_clear_queue",
	"volume_volume_set",
	"volume_volume_up",
	"volume_volume_down",
	"volume_volume_mute",
	"media_play_announcement",
]

const runCatalogChecks = async (handle: SkillConnHandleType): Promise<void> => {
	const listed = await handle.listTools()
	const names = listed.tools.map((t) => t.name)
	const missing = EXPECTED_TOOLS.filter((t) => !names.includes(t))
	checker.check(
		"every Music Assistant wire name is advertised",
		missing.length === 0,
		`missing=${missing.join(",")}`,
	)
	const clear = listed.tools.find((t) => t.name === "queue_clear_queue")
	checker.check(
		"queue_clear_queue is annotated destructive",
		clear?.annotations?.destructiveHint === true,
		JSON.stringify(clear?.annotations),
	)
	const pause = listed.tools.find((t) => t.name === "playback_pause")
	checker.check(
		"playback writes are annotated non-destructive",
		pause?.annotations?.destructiveHint === false &&
			pause.annotations.readOnlyHint === false,
		JSON.stringify(pause?.annotations),
	)
	const search = listed.tools.find((t) => t.name === "library_search_tracks")
	checker.check(
		"library searches are annotated read-only",
		search?.annotations?.readOnlyHint === true,
		JSON.stringify(search?.annotations),
	)
}

const runSearchChecks = async (handle: SkillConnHandleType): Promise<void> => {
	const tracks = await handle.callTool("library_search_tracks", {
		query: "Radiohead",
		limit: 5,
	})
	const rows = resultList(tracks.structured)
	checker.check(
		"library_search_tracks returns TrackBriefs for the artist",
		rows.length === 2 && rows.every((r) => r.album === "OK Computer"),
		JSON.stringify(rows),
	)
	checker.check(
		"a track brief carries uri, name, artists, album and duration",
		rows.every(
			(r) =>
				typeof r.uri === "string" &&
				typeof r.name === "string" &&
				Array.isArray(r.artists) &&
				typeof r.album === "string" &&
				typeof r.duration === "number",
		),
		JSON.stringify(rows[0]),
	)
	checker.check(
		"the search result also carries a one-line human summary",
		tracks.text.includes("Karma Police"),
		tracks.text,
	)
	const albums = await handle.callTool("library_search_albums", {
		query: "verano",
	})
	checker.check(
		"album search folds diacritics and returns AlbumBriefs",
		resultList(albums.structured)[0]?.name === "Un Verano Sin Ti" &&
			resultList(albums.structured)[0]?.year === 2022,
		JSON.stringify(resultList(albums.structured)),
	)
	const artists = await handle.callTool("library_search_artists", {
		query: "bad",
	})
	checker.check(
		"artist search returns ArtistBriefs",
		resultList(artists.structured)[0]?.name === "Bad Bunny",
		JSON.stringify(resultList(artists.structured)),
	)
}

const runPlaybackChecks = async (
	handle: SkillConnHandleType,
	music: MockMusicServerType,
): Promise<void> => {
	const players = await handle.callTool("players_list_players", {})
	const roster = resultList(players.structured)
	checker.check(
		"players_list_players lists the three fixture players",
		roster.map((p) => p.player_id).join(",") ===
			"kitchen,living_room,voice_pe_1",
		JSON.stringify(roster.map((p) => p.player_id)),
	)
	checker.check(
		"a player brief carries the full state shape",
		roster.every(
			(p) =>
				p.state === "idle" &&
				typeof p.volume_level === "number" &&
				p.volume_muted === false &&
				p.powered === true &&
				p.available === true &&
				p.current_item === null &&
				p.active_group === null &&
				p.synced_to === null,
		),
		JSON.stringify(roster[0]),
	)
	const tracks = await handle.callTool("library_search_tracks", {
		query: "Karma Police",
	})
	const uri = (
		resultList(tracks.structured)[0] as unknown as MockMusicTrackType
	).uri
	const played = await handle.callTool("playback_play_media", {
		queue_id: "kitchen",
		uri,
	})
	checker.check(
		"playback_play_media reports the played item",
		played.status === "ok" && played.text.includes("Karma Police"),
		played.text,
	)
	const afterPlay = await music.state()
	const kitchen = afterPlay.players.find((p) => p.player_id === "kitchen")
	checker.check(
		"/__state shows the player playing with a current item",
		kitchen?.state === "playing" &&
			kitchen.current_item?.name === "Karma Police",
		JSON.stringify(kitchen),
	)
	const queue = afterPlay.queues.find((q) => q.queue_id === "kitchen")
	checker.check(
		"the play filled the player queue",
		queue?.item_count === 1 && queue.items[0]?.name === "Karma Police",
		JSON.stringify(queue),
	)
	const active = await handle.callTool("queue_get_active_queue", {
		player_id: "kitchen",
		include_items: true,
	})
	const brief = resultObject(active.structured)
	checker.check(
		"queue_get_active_queue returns a QueueBrief",
		brief.queue_id === "kitchen" &&
			brief.current_index === 0 &&
			brief.item_count === 1 &&
			brief.shuffle === false &&
			brief.repeat === "off",
		JSON.stringify(brief),
	)
	await handle.callTool("playback_pause", { queue_id: "kitchen" })
	const afterPause = await music.state()
	checker.check(
		"playback_pause pauses the player",
		afterPause.players.find((p) => p.player_id === "kitchen")?.state ===
			"paused",
		JSON.stringify(afterPause.players[0]),
	)
	const volume = await handle.callTool("volume_volume_set", {
		player_id: "kitchen",
		level: 60,
	})
	checker.check(
		"volume_volume_set stores the level",
		resultObject(volume.structured).volume_level === 60,
		volume.text,
	)
	const clamped = await handle.callTool("volume_volume_set", {
		player_id: "kitchen",
		level: 140,
	})
	checker.check(
		"volume_volume_set clamps to 0-100",
		resultObject(clamped.structured).volume_level === 100,
		clamped.text,
	)
	const unknown = await handle.callTool("playback_pause", {
		queue_id: "bathroom",
	})
	checker.check(
		"an unknown player is an error result, not a crash",
		unknown.isError,
		unknown.text,
	)
}

const runBehaviorChecks = async (
	handle: SkillConnHandleType,
	music: MockMusicServerType,
): Promise<void> => {
	await music.setBehavior({ fail: { playback_resume: 1 } })
	const first = await handle.callTool("playback_resume", {
		queue_id: "kitchen",
	})
	checker.check(
		"a fail:1 behavior fails the first call",
		first.isError && first.text.includes("temporarily failed"),
		first.text,
	)
	const second = await handle.callTool("playback_resume", {
		queue_id: "kitchen",
	})
	checker.check(
		"the same call succeeds on the retry",
		!second.isError && second.text.includes("Resumed"),
		second.text,
	)
	await music.setBehavior({})
	await music.reset()
	const afterReset = await music.state()
	checker.check(
		"reset() restores the fixture players and clears the queues",
		afterReset.queues.length === 0 &&
			afterReset.players.every(
				(p) => p.state === "idle" && p.current_item === null,
			),
		JSON.stringify(afterReset.players),
	)
}

const runFailCountIsolationChecks = async (): Promise<void> => {
	const first = await startMockMusic(0, { fail: { playback_pause: 1 } })
	const second = await startMockMusic(0, { fail: { playback_pause: 1 } })
	const plain = await startPlainMcp()
	const firstHandle = await connect(first.url)
	const secondHandle = await connect(second.url)
	const plainHandle = await connect(plain.url)
	try {
		const a1 = await firstHandle.callTool("playback_pause", {
			queue_id: "kitchen",
		})
		const a2 = await firstHandle.callTool("playback_pause", {
			queue_id: "kitchen",
		})
		const b1 = await secondHandle.callTool("playback_pause", {
			queue_id: "kitchen",
		})
		checker.check(
			"fail counts are per server, not per process",
			a1.isError && !a2.isError && b1.isError,
			`a1=${a1.isError} a2=${a2.isError} b1=${b1.isError}`,
		)
		const note = await plainHandle.callTool("NoteRead", { title: "milk" })
		checker.check(
			"a second mock MCP server on the same process is unaffected",
			!note.isError && note.text.includes("buy milk"),
			note.text,
		)
	} finally {
		await firstHandle.close()
		await secondHandle.close()
		await plainHandle.close()
		await first.close()
		await second.close()
		await plain.close()
	}
}

const main = async (): Promise<void> => {
	const music = await startMockMusic(0)
	const handle = await connect(music.url)
	try {
		await runCatalogChecks(handle)
		await runSearchChecks(handle)
		await runPlaybackChecks(handle, music)
		await runBehaviorChecks(handle, music)
	} finally {
		await handle.close()
		await music.close()
	}
	await runFailCountIsolationChecks()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} mock-music checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
