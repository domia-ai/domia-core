import { foldText } from "@/utils/text-tokens"

import type { SkillCallResultType } from "../../types"
import { bestByName, nameScore } from "../../utils/name-match"
import { MA_FULL_COVERAGE_SCORE, MA_NAME_MATCH_MIN } from "./constants"
import type {
	MaMediaType,
	MaPlayerStateType,
	MaPlayerType,
	MaSearchHitType,
	MaSearchKindType,
} from "./types"

const parseProtocolJson = (text: string): unknown => {
	try {
		return JSON.parse(text) as unknown
	} catch {
		return null
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const rowsIn = (value: unknown): Record<string, unknown>[] | null => {
	if (Array.isArray(value)) return value.filter(isRecord)
	if (!isRecord(value)) return null
	for (const key of ["result", "results", "items", "players", "data"]) {
		const inner = value[key]
		if (Array.isArray(inner)) return inner.filter(isRecord)
		if (isRecord(inner)) return [inner]
	}
	return null
}

export const resultRows = (
	result: SkillCallResultType,
): Record<string, unknown>[] => {
	const structured = rowsIn(result.structured)
	if (structured) return structured
	const value = parseProtocolJson(result.text)
	return rowsIn(value) ?? []
}

const stringField = (
	row: Record<string, unknown>,
	keys: string[],
): string | null => {
	for (const key of keys) {
		const value = row[key]
		if (typeof value === "string" && value.trim()) return value.trim()
		if (Array.isArray(value)) {
			const items: unknown[] = value
			const first = items.find(
				(v) => typeof v === "string" && v.trim().length > 0,
			)
			if (typeof first === "string") return first.trim()
			const named = items.find((v) => isRecord(v) && typeof v.name === "string")
			if (isRecord(named) && typeof named.name === "string")
				return named.name.trim()
		}
		if (isRecord(value) && typeof value.name === "string")
			return value.name.trim()
	}
	return null
}

const numberField = (
	row: Record<string, unknown>,
	keys: string[],
): number | null => {
	for (const key of keys) {
		const value = row[key]
		if (typeof value === "number" && Number.isFinite(value)) return value
		if (typeof value === "string" && value.trim()) {
			const parsed = Number(value)
			if (Number.isFinite(parsed)) return parsed
		}
	}
	return null
}

const boolField = (
	row: Record<string, unknown>,
	keys: string[],
	fallback: boolean,
): boolean => {
	for (const key of keys) {
		const value = row[key]
		if (typeof value === "boolean") return value
	}
	return fallback
}

const playerStateOf = (row: Record<string, unknown>): MaPlayerStateType => {
	const raw = stringField(row, ["state", "playback_state", "player_state"])
	const folded = raw ? foldText(raw) : ""
	if (folded.includes("playing")) return "playing"
	if (folded.includes("paused")) return "paused"
	if (folded === "idle" || folded === "off" || folded === "standby")
		return "idle"
	return "unknown"
}

const mediaOf = (row: Record<string, unknown>): MaMediaType | null => {
	const item = ["current_item", "current_media", "now_playing", "media"]
		.map((key) => row[key])
		.find((v) => isRecord(v) || (typeof v === "string" && v.trim() !== ""))
	if (!item) return null
	if (typeof item === "string")
		return { title: item.trim(), artist: null, album: null }
	if (!isRecord(item)) return null
	const title = stringField(item, ["name", "title", "media_title"])
	if (!title) return null
	return {
		title,
		artist: stringField(item, ["artists", "artist", "album_artist"]),
		album: stringField(item, ["album", "album_name"]),
	}
}

export const parsePlayers = (result: SkillCallResultType): MaPlayerType[] => {
	const players: MaPlayerType[] = []
	for (const row of resultRows(result)) {
		const playerId = stringField(row, ["player_id", "id", "entity_id"])
		if (!playerId) continue
		const name = stringField(row, ["name", "display_name", "friendly_name"])
		players.push({
			playerId,
			name: name ?? playerId,
			state: playerStateOf(row),
			available: boolField(row, ["available", "enabled"], true),
			volumeLevel: numberField(row, ["volume_level", "volume"]),
			muted: boolField(row, ["volume_muted", "muted"], false),
			syncedTo: stringField(row, ["synced_to", "sync_to"]),
			activeGroup: stringField(row, ["active_group", "group_id"]),
			nowPlaying: mediaOf(row),
		})
	}
	return players
}

export const parseSearchHits = (
	result: SkillCallResultType,
	kind: MaSearchKindType,
): MaSearchHitType[] => {
	const hits: MaSearchHitType[] = []
	for (const row of resultRows(result)) {
		const uri = stringField(row, ["uri", "media_uri", "item_uri"])
		const name = stringField(row, ["name", "title"])
		if (!uri || !name) continue
		hits.push({
			kind,
			name,
			uri,
			artist:
				kind === "artist"
					? null
					: stringField(row, ["artists", "artist", "album_artist"]),
		})
	}
	return hits
}

const KIND_PRIORITY: Record<MaSearchKindType, number> = {
	artist: 0,
	album: 1,
	track: 2,
}

const byPriority = (a: MaSearchHitType, b: MaSearchHitType): number =>
	KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]

export const planPlay = (
	query: string,
	hits: MaSearchHitType[],
): MaSearchHitType | null => {
	if (hits.length === 0) return null
	const folded = foldText(query)
	const exact = [...hits]
		.sort(byPriority)
		.find((hit) => foldText(hit.name) === folded)
	if (exact) return exact
	const generic = new Set<string>()
	const ranked = [...hits]
		.map((hit) => ({
			hit,
			score: Math.max(
				nameScore(query, hit.name, generic, MA_FULL_COVERAGE_SCORE),
				hit.artist
					? nameScore(
							query,
							`${hit.name} ${hit.artist}`,
							generic,
							MA_FULL_COVERAGE_SCORE,
						)
					: 0,
			),
		}))
		.sort((a, b) => b.score - a.score || byPriority(a.hit, b.hit))
	if (ranked.length > 0 && ranked[0].score >= MA_NAME_MATCH_MIN)
		return ranked[0].hit
	return hits.find((hit) => hit.kind === "track") ?? hits[0]
}

export const aliasedPlayerQuery = (
	aliases: Record<string, string> | undefined,
	query: string,
): string => {
	if (!aliases) return query
	const folded = foldText(query)
	for (const [spoken, target] of Object.entries(aliases))
		if (foldText(spoken) === folded) return target
	return query
}

export const matchPlayer = (
	players: MaPlayerType[],
	query: string,
	generic: Set<string>,
	aliases?: Record<string, string>,
): MaPlayerType | null =>
	bestByName(
		players,
		(player) => [player.name, player.playerId.replace(/[_-]+/g, " ")],
		aliasedPlayerQuery(aliases, query),
		generic,
		MA_NAME_MATCH_MIN,
		MA_FULL_COVERAGE_SCORE,
	)

export const implicitPlayer = (
	players: MaPlayerType[],
): MaPlayerType | null => {
	const available = players.filter((p) => p.available)
	const busy = available.filter(
		(p) => p.state === "playing" || p.state === "paused",
	)
	if (busy.length === 1) return busy[0]
	if (busy.length === 0 && available.length === 1) return available[0]
	return null
}

export const queueTargetOf = (
	player: Pick<MaPlayerType, "playerId" | "syncedTo" | "activeGroup">,
): string => player.syncedTo ?? player.activeGroup ?? player.playerId

export const parseQueueCurrent = (
	result: SkillCallResultType,
): MaMediaType | null => {
	const raw = isRecord(result.structured)
		? result.structured
		: parseProtocolJson(result.text)
	const brief = isRecord(raw) && isRecord(raw.result) ? raw.result : raw
	if (!isRecord(brief) || !Array.isArray(brief.items)) return null
	const items: unknown[] = brief.items
	const index =
		typeof brief.current_index === "number" ? brief.current_index : 0
	const current =
		items.find((it) => isRecord(it) && it.index === index) ?? items[0]
	if (!isRecord(current)) return null
	const name = stringField(current, ["name", "title"])
	if (!name) return null
	const artists = Array.isArray(current.artists)
		? current.artists.filter((a): a is string => typeof a === "string")
		: []
	const artist = artists.length > 0 ? artists.join(", ") : null
	const title =
		artist && name.startsWith(`${artists[0]} - `)
			? name.slice(artists[0].length + 3)
			: name
	return { title, artist, album: null }
}

export const mediaLabel = (media: MaMediaType): string =>
	media.artist ? `${media.title} — ${media.artist}` : media.title

const hitLabel = (hit: MaSearchHitType): string =>
	hit.artist ? `${hit.name} — ${hit.artist}` : hit.name

const render = (template: string, values: Record<string, string>): string =>
	Object.entries(values).reduce(
		(text, [key, value]) => text.split(`{${key}}`).join(value),
		template,
	)

export const playingText = (
	phrases: Record<string, string>,
	hit: MaSearchHitType,
	playerName: string,
): string =>
	render(phrases.musicPlaying, { what: hitLabel(hit), player: playerName })

export const nowPlayingText = (
	phrases: Record<string, string>,
	player: MaPlayerType | null,
): string => {
	if (!player?.nowPlaying || player.state === "idle")
		return phrases.musicNothingPlaying
	return render(phrases.musicNowPlaying, {
		what: mediaLabel(player.nowPlaying),
		player: player.name,
	})
}

export const notFoundText = (
	phrases: Record<string, string>,
	query: string,
): string => render(phrases.musicNotFound, { query })

export const volumeChangedText = (
	phrases: Record<string, string>,
	playerName: string,
	level: number,
): string =>
	render(phrases.musicVolumeChanged, {
		player: playerName,
		level: String(level),
	})

export const volumeFailedText = (
	phrases: Record<string, string>,
	playerName: string,
): string => render(phrases.musicVolumeFailed, { player: playerName })

export const playerUnavailableText = (
	phrases: Record<string, string>,
	playerName: string,
): string => render(phrases.musicPlayerUnavailable, { player: playerName })
