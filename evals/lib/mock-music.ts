import { createServer } from "http"
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node"
import { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"

import { createBehaviorGate, withPoison } from "./mock-behavior"
import type {
	MockBehaviorGateType,
	MockMusicBehaviorType,
	MockMusicCurrentItemType,
	MockMusicPlayerType,
	MockMusicQueueType,
	MockMusicServerType,
	MockMusicStateType,
	MockMusicTrackType,
} from "../types"

const ARTISTS = [
	{ uri: "spotify://artist/radiohead", name: "Radiohead" },
	{ uri: "spotify://artist/bad-bunny", name: "Bad Bunny" },
]

const ALBUMS = [
	{
		uri: "spotify://album/ok-computer",
		name: "OK Computer",
		artist: "Radiohead",
		year: 1997,
	},
	{
		uri: "spotify://album/un-verano-sin-ti",
		name: "Un Verano Sin Ti",
		artist: "Bad Bunny",
		year: 2022,
	},
]

const TRACKS: MockMusicTrackType[] = [
	{
		uri: "spotify://track/karma-police",
		name: "Karma Police",
		artists: ["Radiohead"],
		album: "OK Computer",
		duration: 264,
	},
	{
		uri: "spotify://track/paranoid-android",
		name: "Paranoid Android",
		artists: ["Radiohead"],
		album: "OK Computer",
		duration: 383,
	},
	{
		uri: "spotify://track/titi-me-pregunto",
		name: "Tití Me Preguntó",
		artists: ["Bad Bunny"],
		album: "Un Verano Sin Ti",
		duration: 243,
	},
]

const PLAYER_FIXTURES = [
	{ player_id: "kitchen", name: "Kitchen", volume_level: 35 },
	{ player_id: "living_room", name: "Living Room", volume_level: 45 },
	{ player_id: "voice_pe_1", name: "Voice PE 1", volume_level: 50 },
]

export const mockMusicPlayers = (): { playerId: string; name: string }[] =>
	PLAYER_FIXTURES.map((p) => ({ playerId: p.player_id, name: p.name }))

export const mockMusicTracks = (): MockMusicTrackType[] =>
	TRACKS.map((t) => ({ ...t }))

const defaultBehavior = (): MockMusicBehaviorType => ({
	latencyMs: {},
	fail: {},
	poison: {},
})

const createPlayers = (): MockMusicPlayerType[] =>
	PLAYER_FIXTURES.map((p) => ({
		player_id: p.player_id,
		name: p.name,
		state: "idle" as const,
		volume_level: p.volume_level,
		volume_muted: false,
		powered: true,
		available: true,
		current_item: null,
		active_group: null,
		synced_to: null,
	}))

const fold = (value: string): string =>
	value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.trim()

const matches = (haystack: string[], query: string): boolean => {
	const needle = fold(query)
	if (!needle) return true
	return haystack.some((h) => fold(h).includes(needle))
}

const trackBrief = (track: MockMusicTrackType) => ({
	uri: track.uri,
	name: track.name,
	artists: track.artists,
	album: track.album,
	duration: track.duration,
})

const albumBrief = (album: (typeof ALBUMS)[number]) => ({
	uri: album.uri,
	name: album.name,
	artist: album.artist,
	year: album.year,
})

const artistBrief = (artist: (typeof ARTISTS)[number]) => ({
	uri: artist.uri,
	name: artist.name,
})

const playerBrief = (player: MockMusicPlayerType): MockMusicPlayerType => ({
	...player,
	current_item: player.current_item ? { ...player.current_item } : null,
})

const queueItem = (
	queueId: string,
	track: MockMusicTrackType,
	index: number,
) => ({
	item_id: `${queueId}-${index}`,
	name: track.name,
	index,
	duration: track.duration,
	artists: track.artists,
})

const emptyQueue = (queueId: string): MockMusicQueueType => ({
	queue_id: queueId,
	current_index: 0,
	item_count: 0,
	items: [],
	shuffle: false,
	repeat: "off",
})

const currentItemOf = (
	queue: MockMusicQueueType,
): MockMusicCurrentItemType | null => {
	const item = queue.items.at(queue.current_index)
	if (!item) return null
	const track = TRACKS.find((t) => t.name === item.name)
	return {
		item_id: item.item_id,
		name: item.name,
		artists: item.artists,
		album: track?.album ?? "",
		duration: item.duration,
		uri: track?.uri ?? "",
	}
}

const tracksForUri = (uri: string): MockMusicTrackType[] => {
	const track = TRACKS.find((t) => t.uri === uri)
	if (track) return [track]
	const album = ALBUMS.find((a) => a.uri === uri)
	if (album) return TRACKS.filter((t) => t.album === album.name)
	const artist = ARTISTS.find((a) => a.uri === uri)
	if (artist) return TRACKS.filter((t) => t.artists.includes(artist.name))
	return []
}

const READ_ANNOTATIONS = { readOnlyHint: true, openWorldHint: false }

const WRITE_ANNOTATIONS = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
}

const toolResult = (
	summary: string,
	result: unknown,
): {
	content: { type: "text"; text: string }[]
	structuredContent: { result: unknown }
} => ({
	content: [{ type: "text" as const, text: summary }],
	structuredContent: { result },
})

const errResult = (
	message: string,
): { content: { type: "text"; text: string }[]; isError: true } => ({
	content: [{ type: "text" as const, text: message }],
	isError: true,
})

const clampLevel = (level: number): number =>
	Math.max(0, Math.min(100, Math.round(level)))

const registerLibraryTools = (
	mcp: McpServer,
	gate: MockBehaviorGateType,
): void => {
	const searches = [
		{
			name: "library_search_tracks",
			description: "Searches the music library for tracks matching a query.",
			run: (query: string, limit: number) =>
				TRACKS.filter((t) => matches([t.name, t.album, ...t.artists], query))
					.slice(0, limit)
					.map(trackBrief),
		},
		{
			name: "library_search_albums",
			description: "Searches the music library for albums matching a query.",
			run: (query: string, limit: number) =>
				ALBUMS.filter((a) => matches([a.name, a.artist], query))
					.slice(0, limit)
					.map(albumBrief),
		},
		{
			name: "library_search_artists",
			description: "Searches the music library for artists matching a query.",
			run: (query: string, limit: number) =>
				ARTISTS.filter((a) => matches([a.name], query))
					.slice(0, limit)
					.map(artistBrief),
		},
	]
	for (const search of searches)
		mcp.registerTool(
			search.name,
			{
				description: search.description,
				inputSchema: z.object({
					query: z.string(),
					limit: z.number().optional(),
				}),
				annotations: READ_ANNOTATIONS,
			},
			async (args) => {
				const err = await gate.check(search.name)
				if (err) return errResult(err)
				const hits = search.run(args.query, args.limit ?? 5)
				return toolResult(
					withPoison(
						gate,
						search.name,
						`${hits.length} result(s) for "${args.query}": ${hits.map((h) => h.name).join(", ")}`,
					),
					hits,
				)
			},
		)
}

const registerPlayerTools = (
	mcp: McpServer,
	players: MockMusicPlayerType[],
	gate: MockBehaviorGateType,
): void => {
	mcp.registerTool(
		"players_list_players",
		{
			description: "Lists the music players known to the server.",
			inputSchema: z.object({
				include_unavailable: z.boolean().optional(),
				include_disabled: z.boolean().optional(),
			}),
			annotations: READ_ANNOTATIONS,
		},
		async (args) => {
			const err = await gate.check("players_list_players")
			if (err) return errResult(err)
			const hits = players
				.filter((p) => args.include_unavailable === true || p.available)
				.map(playerBrief)
			return toolResult(
				withPoison(
					gate,
					"players_list_players",
					`${hits.length} player(s): ${hits.map((p) => `${p.name} (${p.state})`).join(", ")}`,
				),
				hits,
			)
		},
	)
	mcp.registerTool(
		"players_get_player",
		{
			description: "Returns the current state of one music player.",
			inputSchema: z.object({ player_id: z.string() }),
			annotations: READ_ANNOTATIONS,
		},
		async (args) => {
			const err = await gate.check("players_get_player")
			if (err) return errResult(err)
			const player = players.find((p) => p.player_id === args.player_id)
			if (!player) return errResult(`Error: unknown player ${args.player_id}`)
			return toolResult(
				withPoison(
					gate,
					"players_get_player",
					`${player.name} is ${player.state}${player.current_item ? ` on ${player.current_item.name}` : ""}`,
				),
				playerBrief(player),
			)
		},
	)
}

const registerPlaybackTools = (
	mcp: McpServer,
	players: MockMusicPlayerType[],
	queues: Map<string, MockMusicQueueType>,
	gate: MockBehaviorGateType,
): void => {
	const queueOf = (queueId: string): MockMusicQueueType => {
		const existing = queues.get(queueId)
		if (existing) return existing
		const fresh = emptyQueue(queueId)
		queues.set(queueId, fresh)
		return fresh
	}
	const step = (player: MockMusicPlayerType, delta: number): string => {
		const queue = queueOf(player.player_id)
		if (queue.items.length === 0) return `${player.name} has an empty queue`
		queue.current_index =
			(queue.current_index + delta + queue.items.length) % queue.items.length
		player.current_item = currentItemOf(queue)
		player.state = "playing"
		return `${player.name} now playing ${player.current_item?.name ?? "nothing"}`
	}
	mcp.registerTool(
		"playback_play_media",
		{
			description:
				"Plays a media item (track, album or artist uri) on a player queue.",
			inputSchema: z.object({
				queue_id: z.string(),
				uri: z.string(),
				radio: z.boolean().optional(),
			}),
			annotations: WRITE_ANNOTATIONS,
		},
		async (args) => {
			const err = await gate.check("playback_play_media")
			if (err) return errResult(err)
			const player = players.find((p) => p.player_id === args.queue_id)
			if (!player) return errResult(`Error: unknown player ${args.queue_id}`)
			const tracks = tracksForUri(args.uri)
			if (tracks.length === 0)
				return errResult(`Error: nothing found for uri ${args.uri}`)
			const queue = queueOf(player.player_id)
			queue.items = tracks.map((track, i) =>
				queueItem(player.player_id, track, i),
			)
			queue.item_count = queue.items.length
			queue.current_index = 0
			player.state = "playing"
			player.current_item = currentItemOf(queue)
			return toolResult(
				withPoison(
					gate,
					"playback_play_media",
					`Playing ${player.current_item?.name ?? "media"} on ${player.name}`,
				),
				playerBrief(player),
			)
		},
	)
	const actions = [
		{
			name: "playback_pause",
			description: "Pauses playback on a player queue.",
			apply: (player: MockMusicPlayerType) => {
				player.state = "paused"
				return `Paused ${player.name}`
			},
		},
		{
			name: "playback_resume",
			description: "Resumes playback on a player queue.",
			apply: (player: MockMusicPlayerType) => {
				player.state = "playing"
				return `Resumed ${player.name}`
			},
		},
		{
			name: "playback_play_pause",
			description: "Toggles between play and pause on a player queue.",
			apply: (player: MockMusicPlayerType) => {
				player.state = player.state === "playing" ? "paused" : "playing"
				return `${player.name} is ${player.state}`
			},
		},
		{
			name: "playback_stop",
			description: "Stops playback on a player queue.",
			apply: (player: MockMusicPlayerType) => {
				player.state = "idle"
				player.current_item = null
				return `Stopped ${player.name}`
			},
		},
		{
			name: "playback_next_track",
			description: "Skips to the next track on a player queue.",
			apply: (player: MockMusicPlayerType) => step(player, 1),
		},
		{
			name: "playback_previous_track",
			description: "Goes back to the previous track on a player queue.",
			apply: (player: MockMusicPlayerType) => step(player, -1),
		},
	]
	for (const action of actions)
		mcp.registerTool(
			action.name,
			{
				description: action.description,
				inputSchema: z.object({ queue_id: z.string() }),
				annotations: WRITE_ANNOTATIONS,
			},
			async (args) => {
				const err = await gate.check(action.name)
				if (err) return errResult(err)
				const player = players.find((p) => p.player_id === args.queue_id)
				if (!player) return errResult(`Error: unknown player ${args.queue_id}`)
				const summary = action.apply(player)
				return toolResult(
					withPoison(gate, action.name, summary),
					playerBrief(player),
				)
			},
		)
	mcp.registerTool(
		"queue_get_active_queue",
		{
			description: "Returns the active queue of a player.",
			inputSchema: z.object({
				player_id: z.string().optional(),
				queue_id: z.string().optional(),
				include_items: z.boolean().optional(),
			}),
			annotations: READ_ANNOTATIONS,
		},
		async (args) => {
			const err = await gate.check("queue_get_active_queue")
			if (err) return errResult(err)
			const id = args.queue_id ?? args.player_id
			const player = players.find((p) => p.player_id === id)
			if (!player) return errResult(`Error: unknown player ${String(id)}`)
			const queue = queueOf(player.player_id)
			const brief =
				args.include_items === false ? { ...queue, items: [] } : { ...queue }
			return toolResult(
				withPoison(
					gate,
					"queue_get_active_queue",
					`${player.name} queue has ${queue.item_count} item(s) at index ${queue.current_index}`,
				),
				brief,
			)
		},
	)
	mcp.registerTool(
		"queue_clear_queue",
		{
			description: "Clears every item from a player queue.",
			inputSchema: z.object({ queue_id: z.string() }),
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				openWorldHint: false,
			},
		},
		async (args) => {
			const err = await gate.check("queue_clear_queue")
			if (err) return errResult(err)
			const player = players.find((p) => p.player_id === args.queue_id)
			if (!player) return errResult(`Error: unknown player ${args.queue_id}`)
			const queue = queueOf(player.player_id)
			queue.items = []
			queue.item_count = 0
			queue.current_index = 0
			player.state = "idle"
			player.current_item = null
			return toolResult(
				withPoison(gate, "queue_clear_queue", `Cleared ${player.name}`),
				{ ...queue },
			)
		},
	)
}

const registerVolumeTools = (
	mcp: McpServer,
	players: MockMusicPlayerType[],
	gate: MockBehaviorGateType,
): void => {
	mcp.registerTool(
		"volume_volume_set",
		{
			description: "Sets the volume of a player to an absolute level.",
			inputSchema: z.object({ player_id: z.string(), level: z.number() }),
			annotations: WRITE_ANNOTATIONS,
		},
		async (args) => {
			const err = await gate.check("volume_volume_set")
			if (err) return errResult(err)
			const player = players.find((p) => p.player_id === args.player_id)
			if (!player) return errResult(`Error: unknown player ${args.player_id}`)
			player.volume_level = clampLevel(args.level)
			return toolResult(
				withPoison(
					gate,
					"volume_volume_set",
					`${player.name} volume is ${player.volume_level}`,
				),
				playerBrief(player),
			)
		},
	)
	const steps = [
		{
			name: "volume_volume_up",
			description: "Raises the volume of a player one step.",
			delta: 5,
		},
		{
			name: "volume_volume_down",
			description: "Lowers the volume of a player one step.",
			delta: -5,
		},
	]
	for (const stepTool of steps)
		mcp.registerTool(
			stepTool.name,
			{
				description: stepTool.description,
				inputSchema: z.object({ player_id: z.string() }),
				annotations: WRITE_ANNOTATIONS,
			},
			async (args) => {
				const err = await gate.check(stepTool.name)
				if (err) return errResult(err)
				const player = players.find((p) => p.player_id === args.player_id)
				if (!player) return errResult(`Error: unknown player ${args.player_id}`)
				player.volume_level = clampLevel(player.volume_level + stepTool.delta)
				return toolResult(
					withPoison(
						gate,
						stepTool.name,
						`${player.name} volume is ${player.volume_level}`,
					),
					playerBrief(player),
				)
			},
		)
	mcp.registerTool(
		"volume_volume_mute",
		{
			description: "Mutes or unmutes a player.",
			inputSchema: z.object({
				player_id: z.string(),
				muted: z.boolean().optional(),
			}),
			annotations: WRITE_ANNOTATIONS,
		},
		async (args) => {
			const err = await gate.check("volume_volume_mute")
			if (err) return errResult(err)
			const player = players.find((p) => p.player_id === args.player_id)
			if (!player) return errResult(`Error: unknown player ${args.player_id}`)
			player.volume_muted = args.muted ?? !player.volume_muted
			return toolResult(
				withPoison(
					gate,
					"volume_volume_mute",
					`${player.name} is ${player.volume_muted ? "muted" : "unmuted"}`,
				),
				playerBrief(player),
			)
		},
	)
	mcp.registerTool(
		"media_play_announcement",
		{
			description: "Plays an announcement url on a player.",
			inputSchema: z.object({
				player_id: z.string(),
				url: z.string(),
				volume_level: z.number().optional(),
			}),
			annotations: WRITE_ANNOTATIONS,
		},
		async (args) => {
			const err = await gate.check("media_play_announcement")
			if (err) return errResult(err)
			const player = players.find((p) => p.player_id === args.player_id)
			if (!player) return errResult(`Error: unknown player ${args.player_id}`)
			return toolResult(
				withPoison(
					gate,
					"media_play_announcement",
					`Announced on ${player.name}`,
				),
				{
					player_id: player.player_id,
					url: args.url,
					volume_level: args.volume_level ?? player.volume_level,
				},
			)
		},
	)
}

const buildMusicServer = (
	players: MockMusicPlayerType[],
	queues: Map<string, MockMusicQueueType>,
	gate: MockBehaviorGateType,
): McpServer => {
	const mcp = new McpServer({ name: "eval-mock-music", version: "1.0.0" })
	registerLibraryTools(mcp, gate)
	registerPlayerTools(mcp, players, gate)
	registerPlaybackTools(mcp, players, queues, gate)
	registerVolumeTools(mcp, players, gate)
	return mcp
}

const readBody = (req: import("http").IncomingMessage): Promise<string> =>
	new Promise((resolve) => {
		let body = ""
		req.on("data", (c: Buffer) => (body += c.toString()))
		req.on("end", () => resolve(body))
	})

export const startMockMusic = async (
	port = 0,
	baseBehavior: Partial<MockMusicBehaviorType> = {},
): Promise<MockMusicServerType> => {
	let behavior = { ...defaultBehavior(), ...baseBehavior }
	const players = createPlayers()
	const queues = new Map<string, MockMusicQueueType>()
	const gate = createBehaviorGate(() => behavior)
	const server = createServer((req, res) => {
		if (req.url === "/__control" && req.method === "POST") {
			void readBody(req).then((body) => {
				try {
					const patch = JSON.parse(
						body || "{}",
					) as Partial<MockMusicBehaviorType>
					behavior = { ...defaultBehavior(), ...baseBehavior, ...patch }
					gate.resetCounts()
					res.writeHead(200, { "content-type": "application/json" })
					res.end(JSON.stringify(behavior))
				} catch {
					res.writeHead(400).end()
				}
			})
			return
		}
		if (req.url === "/__reset" && req.method === "POST") {
			players.splice(0, players.length, ...createPlayers())
			queues.clear()
			behavior = { ...defaultBehavior(), ...baseBehavior }
			gate.resetCounts()
			res.writeHead(200, { "content-type": "application/json" })
			res.end(JSON.stringify({ reset: true }))
			return
		}
		if (req.url === "/__state" && req.method === "GET") {
			const state: MockMusicStateType = {
				players: players.map(playerBrief),
				queues: [...queues.values()].map((q) => ({ ...q })),
			}
			res.writeHead(200, { "content-type": "application/json" })
			res.end(JSON.stringify(state))
			return
		}
		void (async () => {
			const mcp = buildMusicServer(players, queues, gate)
			const transport = new NodeStreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
			})
			res.on("close", () => {
				void transport.close()
				void mcp.close()
			})
			await mcp.connect(transport)
			await transport.handleRequest(req, res)
		})().catch(() => {
			if (!res.headersSent) res.writeHead(500).end()
		})
	})
	await new Promise<void>((resolve) =>
		server.listen(port, "127.0.0.1", resolve),
	)
	const address = server.address()
	const boundPort = typeof address === "object" && address ? address.port : port
	const base = `http://127.0.0.1:${boundPort}`
	return {
		url: `${base}/mcp`,
		setBehavior: async (patch) => {
			await fetch(`${base}/__control`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(patch),
			})
		},
		reset: async () => {
			await fetch(`${base}/__reset`, { method: "POST" })
		},
		state: async () => {
			const res = await fetch(`${base}/__state`)
			return (await res.json()) as MockMusicStateType
		},
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve())
				server.closeAllConnections()
			}),
	}
}
