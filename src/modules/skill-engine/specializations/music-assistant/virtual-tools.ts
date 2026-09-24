import type { SelectSkillProviderType } from "@/db"
import { languageSetsFor, skillEngineLogger } from "@/utils"

import type {
	RawSkillToolType,
	SkillCallResultType,
	SkillConnHandleType,
} from "../../types"
import {
	MA_ARG_INCLUDE_ITEMS,
	MA_ARG_LIMIT,
	MA_ARG_PLAYER,
	MA_ARG_PLAYER_ID,
	MA_ARG_QUERY,
	MA_ARG_QUEUE_ID,
	MA_ARG_RADIO,
	MA_ARG_URI,
	MA_NOW_PLAYING_QUEUE_ITEMS,
	MA_TOOL_ACTIVE_QUEUE,
	MA_TOOL_MUSIC_PLAY,
	MA_TOOL_NOW_PLAYING,
	MA_TOOL_PLAY_MEDIA,
	MA_TOOL_SEARCH_ALBUMS,
	MA_TOOL_SEARCH_ARTISTS,
	MA_TOOL_SEARCH_TRACKS,
} from "./constants"
import {
	notFoundText,
	nowPlayingText,
	parseQueueCurrent,
	parseSearchHits,
	planPlay,
	playerUnavailableText,
	playingText,
	queueTargetOf,
} from "./planner"
import {
	ensureRoster,
	isPlausiblePlayerName,
	playerRoster,
	resolvePlayer,
	searchLimitOf,
} from "./roster"
import { runVolumeViaTransport } from "./volume"
import type { MaPlayerType, MaSearchHitType, MaSearchKindType } from "./types"

const playerProperty = {
	type: "string",
	description:
		"The speaker or room the person named, copied from their own words. Leave it out when they named none — never guess one.",
}

export const maVirtualTools = (): RawSkillToolType[] => [
	{
		name: MA_TOOL_MUSIC_PLAY,
		description:
			"Plays music by name: an artist, an album, a song, or a free description. Use this for any request to play or put on music. When the person names a room or speaker, pass it as player.",
		inputSchema: {
			type: "object",
			properties: {
				[MA_ARG_QUERY]: {
					type: "string",
					description: "What to play, as the user said it.",
				},
				[MA_ARG_PLAYER]: playerProperty,
			},
			required: [MA_ARG_QUERY],
		},
	},
	{
		name: MA_TOOL_NOW_PLAYING,
		description:
			"Reports the song currently playing and on which speaker. Use it to answer what is playing.",
		inputSchema: {
			type: "object",
			properties: { [MA_ARG_PLAYER]: playerProperty },
		},
	},
]

const ok = (
	text: string,
	speakableText: string,
	structured: unknown,
): SkillCallResultType => ({
	text,
	status: "ok",
	isError: false,
	speakableText,
	structured,
})

const failed = (
	speakableText: string,
	detail?: string,
): SkillCallResultType => ({
	text: detail ? `${speakableText} (${detail})` : speakableText,
	status: "error",
	isError: true,
	speakableText,
})

const spokenPlayer = (args: Record<string, unknown>): string | null => {
	const value = args[MA_ARG_PLAYER]
	const trimmed = typeof value === "string" ? value.trim() : ""
	return trimmed && isPlausiblePlayerName(trimmed) ? trimmed : null
}

const targetPlayer = async (
	provider: SelectSkillProviderType,
	args: Record<string, unknown>,
	language: string | null,
): Promise<MaPlayerType | null> => {
	const id = args[MA_ARG_PLAYER_ID]
	const preResolved =
		typeof id === "string" && id
			? playerRoster.snapshot(provider.id).find((p) => p.playerId === id)
			: undefined
	return preResolved ?? resolvePlayer(provider, spokenPlayer(args), language)
}

const searchOne = async (
	handle: SkillConnHandleType,
	tool: string,
	kind: MaSearchKindType,
	query: string,
	limit: number,
	signal?: AbortSignal,
): Promise<MaSearchHitType[]> => {
	try {
		const res = await handle.callTool(
			tool,
			{ [MA_ARG_QUERY]: query, [MA_ARG_LIMIT]: limit },
			signal,
		)
		if (res.isError) return []
		return parseSearchHits(res, kind)
	} catch (err) {
		skillEngineLogger.warn("music search failed", { tool, err })
		return []
	}
}

const searchAll = async (
	handle: SkillConnHandleType,
	query: string,
	limit: number,
	signal?: AbortSignal,
): Promise<MaSearchHitType[]> => {
	const [artists, albums, tracks] = await Promise.all([
		searchOne(handle, MA_TOOL_SEARCH_ARTISTS, "artist", query, limit, signal),
		searchOne(handle, MA_TOOL_SEARCH_ALBUMS, "album", query, limit, signal),
		searchOne(handle, MA_TOOL_SEARCH_TRACKS, "track", query, limit, signal),
	])
	return [...artists, ...albums, ...tracks]
}

const runMusicPlay = async (
	provider: SelectSkillProviderType,
	handle: SkillConnHandleType,
	args: Record<string, unknown>,
	language: string | null,
	signal?: AbortSignal,
): Promise<SkillCallResultType> => {
	const phrases = languageSetsFor(language).phrases
	const rawQuery = args[MA_ARG_QUERY]
	const query = typeof rawQuery === "string" ? rawQuery.trim() : ""
	if (!query) return failed(phrases.musicWhichMusic)
	const spoken = spokenPlayer(args)
	playerRoster.attach(provider, handle)
	const [hits] = await Promise.all([
		searchAll(handle, query, searchLimitOf(provider), signal),
		ensureRoster(provider, signal),
	])
	const player = await targetPlayer(provider, args, language)
	const hit = planPlay(query, hits)
	if (!hit) return failed(notFoundText(phrases, query))
	if (!player)
		return failed(
			spoken
				? playerUnavailableText(phrases, spoken)
				: phrases.musicWhichSpeaker,
		)
	const res = await handle.callTool(
		MA_TOOL_PLAY_MEDIA,
		{
			[MA_ARG_QUEUE_ID]: queueTargetOf(player),
			[MA_ARG_URI]: hit.uri,
			[MA_ARG_RADIO]: false,
		},
		signal,
	)
	if (res.isError || res.status !== "ok")
		return failed(playerUnavailableText(phrases, player.name), res.text)
	await playerRoster.refresh(provider.id, signal)
	const reply = playingText(phrases, hit, player.name)
	return ok(
		`${reply} ${res.text}`.trim(),
		reply,
		res.structured ?? { uri: hit.uri, player: player.playerId },
	)
}

const enrichNowPlaying = async (
	handle: SkillConnHandleType,
	player: MaPlayerType,
	signal?: AbortSignal,
): Promise<MaPlayerType> => {
	const res = await handle.callTool(
		MA_TOOL_ACTIVE_QUEUE,
		{
			[MA_ARG_PLAYER_ID]: player.playerId,
			[MA_ARG_INCLUDE_ITEMS]: MA_NOW_PLAYING_QUEUE_ITEMS,
		},
		signal,
	)
	if (res.isError) return player
	const current = parseQueueCurrent(res)
	return current ? { ...player, nowPlaying: current } : player
}

const runNowPlaying = async (
	provider: SelectSkillProviderType,
	handle: SkillConnHandleType,
	args: Record<string, unknown>,
	language: string | null,
	signal?: AbortSignal,
): Promise<SkillCallResultType> => {
	const phrases = languageSetsFor(language).phrases
	playerRoster.attach(provider, handle)
	await playerRoster.refresh(provider.id, signal)
	const spoken = spokenPlayer(args)
	const player = await targetPlayer(provider, args, language)
	if (!player && spoken) return failed(playerUnavailableText(phrases, spoken))
	const players = playerRoster.snapshot(provider.id)
	const chosen =
		player ?? players.find((p) => p.state === "playing" && p.nowPlaying) ?? null
	const target =
		chosen && chosen.state !== "idle" && !chosen.nowPlaying?.artist
			? await enrichNowPlaying(handle, chosen, signal)
			: chosen
	const text = nowPlayingText(phrases, target)
	return ok(text, text, {
		player: target?.playerId ?? null,
		state: target?.state ?? null,
		nowPlaying: target?.nowPlaying ?? null,
	})
}

export const callMaVirtualTool = (
	provider: SelectSkillProviderType,
	handle: SkillConnHandleType,
	rawName: string,
	args: Record<string, unknown>,
	language: string | null,
	signal?: AbortSignal,
): Promise<SkillCallResultType> | null => {
	if (rawName === MA_TOOL_MUSIC_PLAY)
		return runMusicPlay(provider, handle, args, language, signal)
	if (rawName === MA_TOOL_NOW_PLAYING)
		return runNowPlaying(provider, handle, args, language, signal)
	return runVolumeViaTransport(provider, rawName, args, language)
}
