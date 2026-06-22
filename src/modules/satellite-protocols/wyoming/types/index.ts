export type WyomingEventHandlerType = (
	type: string,
	data: Record<string, unknown>,
	payload: Buffer | null,
) => void

export type WyomingSatelliteHandleType = {
	close: () => void
}
