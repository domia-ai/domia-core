import { type AudioPlaybackEngineEnumType } from "@/db"

export type AudioPlaybackResult = {
	success: boolean
	engine: AudioPlaybackEngineEnumType
}
