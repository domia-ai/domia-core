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
