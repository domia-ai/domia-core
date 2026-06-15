import { type AudioPlaybackEngineEnumType } from "@/db"

export type AudioPlaybackResult = {
	success: boolean
	engine: AudioPlaybackEngineEnumType
	interrupted?: boolean
}

export type SoxStreamOptionsType = {
	sampleRate: number
	channels: 1 | 2
	bitsPerSample: 16
	onFirstChunkWritten?: () => void
}
