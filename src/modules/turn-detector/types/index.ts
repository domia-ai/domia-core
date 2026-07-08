import type { TurnDetectorEngineEnumType } from "@/db"

export type TurnDetectorResultType = {
	probability: number
	complete: boolean
}

export type TurnDetectorCapabilitiesType = {
	sampleRate: number
	mels: number
}

export type TurnDetectorEngineAdapterType = {
	id: TurnDetectorEngineEnumType
	capabilities: TurnDetectorCapabilitiesType
	available: (modelPath: string) => boolean
	warm: (modelPath: string) => void
	predict: (
		audio16k: Float32Array,
		modelPath: string,
		threshold?: number,
	) => Promise<TurnDetectorResultType | null>
}
