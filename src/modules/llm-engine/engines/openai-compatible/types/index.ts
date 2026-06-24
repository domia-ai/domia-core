export type OpenAiResolvedConfigType = {
	baseURL: string
	apiKey: string
	temperature?: number
	maxTokens?: number
}

export type LlamaTimingsType = {
	predicted_per_second?: number
	prompt_ms?: number
}
