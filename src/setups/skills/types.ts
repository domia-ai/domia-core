export type McpSetupHandleType = {
	stop: () => Promise<void>
	stopTimers: () => void
}
