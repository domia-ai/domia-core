export type SttCliOptionsType = {
	file: string
	engine?: string
	model?: string
	baseUrl?: string
	apiKey?: string
}

export type LlmCliOptionsType = {
	prompt: string
}

export type LlmBatchCliOptionsType = {
	input: string
	output: string
}

export type TtsCliOptionsType = {
	text: string
	engine?: string
	voice?: string
}

export type AudioFileCliOptionsType = {
	file: string
}

export type BenchmarkCliOptionsType = {
	file: string
	corpus?: string
	sttEngine?: string
	sttBaseUrl?: string
}

export type CorpusCliOptionsType = {
	corpus: string
}

export type CorpusRunCliOptionsType = {
	corpus: string
	out?: string
}

export type CorpusCompareCliOptionsType = {
	baseline: string
	candidate: string
}

export type OutputPathCliOptionsType = {
	out: string
}

export type FactsCleanupCliOptionsType = {
	apply?: boolean
}

export type InteractiveMenuAnswersType = {
	command:
		| "environment"
		| "wake-word"
		| "audio-rec"
		| "stt"
		| "llm"
		| "llm-batch"
		| "tts"
		| "play-audio"
		| "benchmark"
		| "status"
		| "config-health"
		| "config-show"
}

export type InteractiveSttAnswersType = {
	file: string
	engine: string
}

export type InteractiveBaseUrlAnswersType = {
	baseUrl: string
}

export type InteractivePromptAnswersType = {
	prompt: string
}

export type InteractiveBatchAnswersType = {
	input: string
	output: string
}

export type InteractiveTextAnswersType = {
	text: string
}

export type InteractiveFileAnswersType = {
	file: string
}
