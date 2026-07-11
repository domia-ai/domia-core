export type AsyncQueueType<T> = {
	push: (item: T) => void
	isClosed: () => boolean
	waitForSpace: (maxDepth: number) => Promise<void>
	close: () => void
	iter: () => AsyncIterable<T>
}

export type EagerSlotsType = {
	tryAcquire: () => boolean
	release: () => void
}

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
