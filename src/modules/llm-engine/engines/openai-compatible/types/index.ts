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
