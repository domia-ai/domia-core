import { TtsEngineEnumType } from "@/db"

export type RunTtsResultType = {
	engineUsed: TtsEngineEnumType
	voiceUsed: string
	format: "wav" | "mp3"
	filePath: string
	buffer?: Buffer
	durationMs?: number
	metadata?: Record<string, unknown>
}
