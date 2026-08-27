export type PendingCommandType = {
	resolve: (result: unknown) => void
	reject: (err: Error) => void
	timer: ReturnType<typeof setTimeout>
}
