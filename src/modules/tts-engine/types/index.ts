import { TtsEngineEnumType } from "@/db"
import type { DomiaType } from "@/modules/core"

export type RunTtsResultType = {
	engineUsed: TtsEngineEnumType
	voiceUsed: string
	format: "wav" | "mp3"
	filePath: string
	buffer?: Buffer
	durationMs?: number
	metadata?: Record<string, unknown>
}

export type TtsCapabilitiesType = {
	streaming: boolean
	sampleRate: number
	sampleFormat: "PCM_S16LE" | "PCM_F32LE"
	channels: 1 | 2
	languages: string[]
}

export type TtsEngineAdapterType = {
	id: TtsEngineEnumType
	capabilities: TtsCapabilitiesType
	run: (domia: DomiaType, text: string) => Promise<RunTtsResultType>
	runStream?: (domia: DomiaType, text: string) => AsyncIterable<Buffer>
}

export type KokoroPathsType = {
	dir: string
	model: string
	voices: string
	tokens: string
	dataDir: string
}

export type TtsWorkerEngineConfigType = {
	modelPath: string
	numThreads: number
	provider: string
	maxNumSentences: number
}

export type TtsWorkerJobType = {
	engineConfig: TtsWorkerEngineConfigType
	text: string
	sid: number
	speed: number
	silenceScale: number
}

export type TtsWorkerResultType = {
	pcm: Buffer
	sampleRate: number
	channels: 1 | 2
}
