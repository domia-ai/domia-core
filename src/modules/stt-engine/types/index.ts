import type { SttEngineEnumType } from "@/db"
import type { DomiaType } from "@/modules/core"

export type SttCapabilitiesType = {
	streaming: boolean
	expectedSampleRate: number
}

export type SttEngineAdapterType = {
	id: SttEngineEnumType
	capabilities: SttCapabilitiesType
	run: (domia: DomiaType, filePath: string) => Promise<string>
	runStream?: (
		domia: DomiaType,
		audioStream: AsyncIterable<Buffer>,
	) => Promise<string>
}

export type WhisperPathsType = {
	dir: string
	encoder: string
	decoder: string
	tokens: string
}

export type MoonshinePathsType = {
	dir: string
	preprocessor: string
	encoder: string
	uncachedDecoder: string
	cachedDecoder: string
	tokens: string
}

export type ZipformerPathsType = {
	dir: string
	encoder: string
	decoder: string
	joiner: string
	tokens: string
}
