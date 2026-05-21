export type StreamingCapabilitiesType = {
	stt: boolean
	llm: boolean
	tts: boolean
}

export type StreamableAdapterType = {
	capabilities: { streaming: boolean }
	runStream?: unknown
} | null

export type ResolvedDelegateType = {
	domiaKey: string
	domiaId: string
	localIp: string | null
	grpcPort: number | null
	source: "explicit" | "discovered"
	streamingCapabilities: StreamingCapabilitiesType
}
