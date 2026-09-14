export type OpenAiResolvedConfigType = {
	baseURL: string
	apiKey: string
	temperature?: number
	maxTokens?: number
}

export type LlamaTimingsType = {
	predicted_per_second?: number
	prompt_ms?: number
	prompt_n?: number
	cache_n?: number
}

export type ToolCallAccType = { name: string; args: string }

export type PythonicCallSegmentType = { name: string; args: string }

export type GrammarStreamVerdictType =
	| { state: "pending" }
	| { state: "decision" }
	| { state: "reply"; flush: string }

export type GrammarStreamGateType = {
	push: (token: string) => GrammarStreamVerdictType
	end: () => GrammarStreamVerdictType
	buffered: () => string
}
