export type WorkerHandleType = {
	send: (msg: WorkerRequestMessageType) => boolean
	kill: () => void
	onMessage: (cb: (msg: WorkerResponseMessageType) => void) => void
	onExit: (cb: (code: number | null) => void) => void
}

export type WorkerBackendType = {
	spawn: () => WorkerHandleType
}

export type WorkerRequestMessageType =
	| { type: "job"; id: number; payload: unknown }
	| { type: "shutdown" }

export type WorkerResponseMessageType =
	| { type: "ready" }
	| { type: "result"; id: number; result: unknown }
	| { type: "error"; id: number; message: string }

export type InferencePoolConfigType = {
	label: string
	backend: WorkerBackendType
	warmWorkers: number
	maxWorkers: number
	idleTimeoutMs: number
	queueMaxDepth: number
	queueTimeoutMs: number
	recycleAfterJobs: number
}

export type InferencePoolType = {
	submit: <T>(payload: unknown) => Promise<T>
	activeWorkers: () => number
	busyWorkers: () => number
	queuedJobs: () => number
	shutdown: () => Promise<void>
}

export type PendingJobType = {
	payload: unknown
	resolve: (result: unknown) => void
	reject: (err: unknown) => void
	timer: ReturnType<typeof setTimeout> | null
}

export type WorkerStateType = {
	handle: WorkerHandleType
	ready: boolean
	jobs: number
	recycling: boolean
	idleTimer: ReturnType<typeof setTimeout> | null
	currentJob: { id: number; pending: PendingJobType } | null
}
