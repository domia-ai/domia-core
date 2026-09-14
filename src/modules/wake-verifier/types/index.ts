import type { SelectWakeWordConfigType, WakeVerifierEnumType } from "@/db"

export type WakeTranscribeType = (
	pcm: Buffer,
	sampleRate: number,
) => Promise<string>

export type WakeVerifierInputType = {
	pcm: Buffer
	sampleRate: number
	transcribe?: WakeTranscribeType
}

export type WakeVerdictType = {
	accepted: boolean
	score: number
	detail: string
	failedOpen?: boolean
}

export type WakePhraseMatchType = {
	score: number
	candidate: string
}

export type WakeVerifierConfigType = Pick<
	SelectWakeWordConfigType,
	| "wakeWord"
	| "wakeVerifier"
	| "wakeVerifierWindowMs"
	| "wakeVerifierMinRms"
	| "wakeVerifierMinSpeechMs"
	| "wakeVerifierMinScore"
	| "wakeVerifierMaxMs"
>

export type WakeVerifierEngineAdapterType = {
	id: WakeVerifierEnumType
	concurrent: boolean
	verify: (
		input: WakeVerifierInputType,
		config: WakeVerifierConfigType,
	) => Promise<WakeVerdictType>
}
