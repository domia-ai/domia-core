import type { SelectWakeWordConfigType, WakeVerifierEnumType } from "@/db"

export type WakeVerifierInputType = {
	pcm: Buffer
	sampleRate: number
}

export type WakeVerdictType = {
	accepted: boolean
	score: number
	detail: string
}

export type WakeVerifierConfigType = Pick<
	SelectWakeWordConfigType,
	| "wakeVerifier"
	| "wakeVerifierWindowMs"
	| "wakeVerifierMinRms"
	| "wakeVerifierMinSpeechMs"
	| "wakeVerifierMinScore"
>

export type WakeVerifierEngineAdapterType = {
	id: WakeVerifierEnumType
	verify: (
		input: WakeVerifierInputType,
		config: WakeVerifierConfigType,
	) => Promise<WakeVerdictType>
}
