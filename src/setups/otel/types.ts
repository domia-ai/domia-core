export type SetupOtelArgsType = {
	exporterUrl: string | undefined
	serviceName: string
	principalDomiaKey: string
}

export type OtelHandleType = {
	shutdown: () => Promise<void>
	openTurns: () => number
}
