import type { SkillConnHandleType } from "../../../types"

export type MaPlayerStateType = "playing" | "paused" | "idle" | "unknown"

export type MaMediaType = {
	title: string
	artist: string | null
	album: string | null
}

export type MaPlayerType = {
	playerId: string
	name: string
	state: MaPlayerStateType
	available: boolean
	volumeLevel: number | null
	muted: boolean
	syncedTo: string | null
	activeGroup: string | null
	nowPlaying: MaMediaType | null
}

export type MaRosterEntryType = {
	players: MaPlayerType[]
	fetchedAt: number
	handle: SkillConnHandleType | null
	refreshing: boolean
}

export type MaPlayerRosterType = {
	attach: (providerId: string, handle: SkillConnHandleType) => void
	refresh: (providerId: string, signal?: AbortSignal) => Promise<MaPlayerType[]>
	snapshot: (providerId: string, ttlMs?: number) => MaPlayerType[]
	ageMs: (providerId: string) => number | null
	clear: (providerId: string) => void
}

export type MaSearchKindType = "artist" | "album" | "track"

export type MaSearchHitType = {
	kind: MaSearchKindType
	name: string
	uri: string
	artist: string | null
}

export type MaRosterStatusType = {
	players: number
	available: number
	playing: number
	nowPlaying: string | null
	rosterAgeMs: number | null
}

export type MaFastPathLanguagePackType = {
	pauseTemplates: string[]
	pausePlayerTemplates: string[]
	resumeTemplates: string[]
	nextTemplates: string[]
	nextPlayerTemplates: string[]
	previousTemplates: string[]
	volumeSetTemplates: string[]
	volumeUpTemplates: string[]
	volumeUpPlayerTemplates: string[]
	volumeDownTemplates: string[]
	volumeDownPlayerTemplates: string[]
	muteTemplates: string[]
	unmuteTemplates: string[]
	nowPlayingTemplates: string[]
	expansionRules: Record<string, string>
	samples: string[]
}
