export type RunProcessOptionsType = {
	timeoutMs: number
	captureStderr?: boolean
}

export type RunProcessResultType = {
	ok: boolean
	stdout: string
	stderr: string
	timedOut: boolean
}
