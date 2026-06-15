import type {
	OnlineRecognizerInstance,
	OfflineRecognizerInstance,
} from "@/utils/ml-runtime/types"
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
	runPcm?: (domia: DomiaType, pcm: Buffer) => Promise<string>
	createSession?: (domia: DomiaType) => SttStreamSessionType
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

export type ZipformerEndpointConfigType = {
	enableEndpoint: boolean
	rule1MinTrailingSilence: number
	rule2MinTrailingSilence: number
	rule3MinUtteranceLength: number
}

export type SttWorkerEngineConfigType = {
	engine: SttEngineEnumType
	modelPath: string
	modelName: string | null
	quantization: string | null
	numThreads: number
	provider: string
	decodePaddingMs: number
	enableEndpoint: boolean
	rule1MinTrailingSilence: number
	rule2MinTrailingSilence: number
	rule3MinUtteranceLength: number
}

export type SttWorkerJobType =
	| { kind: "file"; engineConfig: SttWorkerEngineConfigType; wavPath: string }
	| {
			kind: "pcm"
			engineConfig: SttWorkerEngineConfigType
			pcm: Buffer
			sampleRate: number
	  }

export type SttWorkerResultType = {
	text: string
}

export type SttSessionJobType =
	| { kind: "session-start"; engineConfig: SttWorkerEngineConfigType }
	| { kind: "session-chunk"; pcm: Buffer; sampleRate: number }
	| { kind: "session-end"; sampleRate: number; decodePaddingMs: number }
	| { kind: "session-abort" }

export type SttSessionResultType =
	| { ok: true }
	| { partial: string }
	| { text: string }

export type SttStreamSessionType = {
	pushChunk: (pcm: Buffer) => void
	partial: () => string
	flushPartial: (padMs: number) => Promise<string>
	finish: () => Promise<string>
	reset: (pcm?: Buffer) => void
	abort: () => void
}

export type RecognizerEntryType =
	| { online: true; rec: OnlineRecognizerInstance }
	| { online: false; rec: OfflineRecognizerInstance }
