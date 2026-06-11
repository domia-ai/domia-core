export type FlushResultType = {
	sentence: string
	remaining: string
} | null

export type SentenceFlushTuningType = {
	softFlushMinChars: number
	firstUnitMaxWords: number
	mediumFlushChars: number
	hardFlushChars: number
	firstFlushMaxMs: number
}
