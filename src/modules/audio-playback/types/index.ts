import { type AudioPlaybackEngineEnumType } from "@/db"

export type AudioPlaybackResult = {
	success: boolean
	engine: AudioPlaybackEngineEnumType
	interrupted?: boolean
	playedMs?: number
	truncated?: boolean
	expectedMs?: number
}

export type PlaybackControlsType = {
	pause: () => boolean
	resume: () => boolean
	positionMs: () => number | null
}

export type ExternalMediaStateType = {
	playing: boolean
	notedAt: number
}

export type ExternalMediaControlsType = {
	origin: "transport"
	setVolume: (level: number) => Promise<boolean>
	getVolume: () => number | null
}

export type SoxStreamOptionsType = {
	sampleRate: number
	channels: 1 | 2
	bitsPerSample: 16
	onFirstChunkWritten?: () => void
}
