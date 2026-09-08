export type WyomingEventHandlerType = (
	type: string,
	data: Record<string, unknown>,
	payload: Buffer | null,
) => void

export type WyomingConnectionType = {
	write: (
		type: string,
		data?: Record<string, unknown>,
		payload?: Buffer,
	) => void
}

export type WyomingSatelliteHandleType = {
	close: () => void
}

export type WyomingSatelliteOptionsType = {
	streamingTts?: boolean
}

export type WyomingTransportDepsType = {
	conn: WyomingConnectionType
	streamingTts: boolean
	close: () => void
	warn: (message: string) => void
	onBeginAudio?: (interactionId: string | undefined) => void
}
