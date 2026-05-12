export type EntryTimingsType = {
	sttMs: number
	llmMs: number
	ttsMs: number
	firstAudioChunkMs: number
	totalMs: number
}

export type EntryResultType = {
	id: string
	category: string
	text: string
	transcript: string
	reply: string
	pass: boolean
	failureReason?: string
	timings: EntryTimingsType
}

export type RunResultType = {
	timestamp: string
	corpusPath: string
	totalEntries: number
	passed: number
	failed: number
	aggregate: {
		p50: EntryTimingsType
		p95: EntryTimingsType
	}
	entries: EntryResultType[]
}
