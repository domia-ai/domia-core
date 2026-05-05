import { type TtsEngineEnumType, type SttEngineEnumType } from "@/db"

export type SynthesizeTtsParams = {
	engine: TtsEngineEnumType
	text: string
	voice?: string
	timeoutMs?: number
}

export type SynthesizeTtsResult = {
	audio: Buffer
	engineUsed: TtsEngineEnumType
	voiceUsed: string
}

export type TranscribeSttParams = {
	engine: SttEngineEnumType
	filePath: string
	modelName?: string
	timeoutMs?: number
}

export type TranscribeSttResult = {
	transcript: string
	engineUsed: SttEngineEnumType
}

export type EngineStatus = {
	loaded: boolean
}

export type EnginesResponse = {
	tts: Record<string, EngineStatus>
	stt: Record<string, EngineStatus>
}
