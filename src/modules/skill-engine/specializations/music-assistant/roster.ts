import type { SelectSkillProviderType } from "@/db"
import { skillEngineLogger, getTraceContext } from "@/utils"

import dbAdapter from "../../db-adapter"
import { resolveDescriptor } from "../../utils/descriptor"
import {
	DEFAULT_MA_ROSTER_TTL_MS,
	DEFAULT_MA_SEARCH_LIMIT,
	DEFAULT_MA_VOLUME_STEP_PERCENT,
	MA_TOOL_LIST_PLAYERS,
} from "./constants"
import {
	implicitPlayer,
	matchPlayer,
	parsePlayers,
	mediaLabel,
} from "./planner"
import type {
	MaPlayerRosterType,
	MaPlayerType,
	MaRosterEntryType,
	MaRosterStatusType,
} from "./types"

export const createPlayerRoster = (): MaPlayerRosterType => {
	const entries = new Map<string, MaRosterEntryType>()

	const entryFor = (providerId: string): MaRosterEntryType => {
		const existing = entries.get(providerId)
		if (existing) return existing
		const fresh: MaRosterEntryType = {
			players: [],
			fetchedAt: 0,
			handle: null,
			refreshing: false,
		}
		entries.set(providerId, fresh)
		return fresh
	}

	const refresh = async (
		providerId: string,
		signal?: AbortSignal,
	): Promise<MaPlayerType[]> => {
		const entry = entryFor(providerId)
		const handle = entry.handle
		if (!handle) return entry.players
		entry.refreshing = true
		try {
			const res = await handle.callTool(MA_TOOL_LIST_PLAYERS, {}, signal)
			if (res.isError) return entry.players
			const players = parsePlayers(res)
			if (players.length === 0) return entry.players
			entry.players = players
			entry.fetchedAt = Date.now()
			skillEngineLogger.info(`🎵 player roster: ${players.length} player(s)`, {
				providerId,
			})
			return players
		} catch (err) {
			skillEngineLogger.warn("music player roster refresh failed", {
				providerId,
				err,
			})
			return entry.players
		} finally {
			entry.refreshing = false
		}
	}

	return {
		attach: (providerId, handle) => {
			entryFor(providerId).handle = handle
		},
		refresh,
		snapshot: (providerId, ttlMs) => {
			const entry = entries.get(providerId)
			if (!entry) return []
			const stale = ttlMs !== undefined && Date.now() - entry.fetchedAt > ttlMs
			if (stale && !entry.refreshing && entry.handle) {
				entry.fetchedAt = Date.now()
				void refresh(providerId)
			}
			return entry.players
		},
		ageMs: (providerId) => {
			const entry = entries.get(providerId)
			if (!entry || entry.fetchedAt === 0) return null
			return Date.now() - entry.fetchedAt
		},
		clear: (providerId) => {
			entries.delete(providerId)
		},
	}
}

export const playerRoster = createPlayerRoster()

const numberSetting = (
	provider: SelectSkillProviderType,
	key: "rosterTtlMs" | "searchLimit" | "volumeStepPercent",
	fallback: number,
): number => {
	const value = provider.config?.[key]
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: fallback
}

export const playerAliasesOf = (
	provider: SelectSkillProviderType,
): Record<string, string> | undefined => provider.config?.playerAliases

export const rosterTtlMsOf = (provider: SelectSkillProviderType): number =>
	numberSetting(provider, "rosterTtlMs", DEFAULT_MA_ROSTER_TTL_MS)

export const searchLimitOf = (provider: SelectSkillProviderType): number =>
	numberSetting(provider, "searchLimit", DEFAULT_MA_SEARCH_LIMIT)

export const volumeStepPercentOf = (
	provider: SelectSkillProviderType,
): number =>
	numberSetting(provider, "volumeStepPercent", DEFAULT_MA_VOLUME_STEP_PERCENT)

export const genericWordsOf = (
	provider: SelectSkillProviderType,
	language: string | null,
): Set<string> => new Set(resolveDescriptor(provider, language).genericWords)

const satellitePlayers = new Map<string, string | null>()

const satellitePlayerKey = (
	provider: SelectSkillProviderType,
	satelliteId: string,
): string => `${provider.domiaId}|${satelliteId}`

export const forgetSatellitePlayers = (
	provider: SelectSkillProviderType,
): void => {
	const prefix = satellitePlayerKey(provider, "")
	for (const key of [...satellitePlayers.keys()])
		if (key.startsWith(prefix)) satellitePlayers.delete(key)
}

export const knownSatellitePlayerName = (
	provider: SelectSkillProviderType,
): string | null => {
	const satelliteId = getTraceContext()?.satelliteId
	if (!satelliteId) return null
	return satellitePlayers.get(satellitePlayerKey(provider, satelliteId)) ?? null
}

export const satellitePlayerName = async (
	provider: SelectSkillProviderType,
): Promise<string | null> => {
	const satelliteId = getTraceContext()?.satelliteId
	if (!satelliteId) return null
	try {
		const row = await dbAdapter.satelliteMediaPlayerName(
			provider.domiaId,
			satelliteId,
		)
		const name = row?.mediaPlayerName ?? null
		satellitePlayers.set(satellitePlayerKey(provider, satelliteId), name)
		return name
	} catch (err) {
		skillEngineLogger.warn("satellite media player lookup failed", {
			providerId: provider.id,
			satelliteId,
			err,
		})
		return null
	}
}

export const ensureRoster = async (
	provider: SelectSkillProviderType,
	signal?: AbortSignal,
): Promise<MaPlayerType[]> => {
	const players = playerRoster.snapshot(provider.id)
	const age = playerRoster.ageMs(provider.id)
	if (players.length > 0 && age !== null && age <= rosterTtlMsOf(provider))
		return players
	return playerRoster.refresh(provider.id, signal)
}

export const resolvePlayer = async (
	provider: SelectSkillProviderType,
	spoken: string | null,
	language: string | null,
): Promise<MaPlayerType | null> => {
	const players = playerRoster.snapshot(provider.id, rosterTtlMsOf(provider))
	if (players.length === 0) return null
	const generic = genericWordsOf(provider, language)
	if (spoken)
		return matchPlayer(players, spoken, generic, playerAliasesOf(provider))
	const preferred = await satellitePlayerName(provider)
	const fromSatellite = preferred
		? matchPlayer(players, preferred, generic)
		: null
	if (fromSatellite) return fromSatellite
	return implicitPlayer(players)
}

export const rosterStatus = (
	provider: SelectSkillProviderType,
): MaRosterStatusType => {
	const players = playerRoster.snapshot(provider.id)
	const playing = players.filter((p) => p.state === "playing")
	const current = playing.find((p) => p.nowPlaying)
	return {
		players: players.length,
		available: players.filter((p) => p.available).length,
		playing: playing.length,
		nowPlaying: current?.nowPlaying ? mediaLabel(current.nowPlaying) : null,
		rosterAgeMs: playerRoster.ageMs(provider.id),
	}
}
