import { inferencePoolLogger } from "@/utils"

import { poolBusyError } from "../utils"
import {
	RESPAWN_BACKOFF_BASE_MS,
	RESPAWN_BACKOFF_MAX_MS,
	RESPAWN_MAX_ATTEMPTS,
} from "../constants"
import type {
	InferencePoolConfigType,
	InferencePoolType,
	PendingJobType,
	PoolSessionType,
	WorkerStateType,
} from "../types"

export const createInferencePool = (
	config: InferencePoolConfigType,
): InferencePoolType => {
	const {
		label,
		backend,
		maxWorkers,
		idleTimeoutMs,
		queueMaxDepth,
		queueTimeoutMs,
		executionTimeoutMs,
		recycleAfterJobs,
	} = config
	const warmWorkers = Math.max(0, Math.min(config.warmWorkers, maxWorkers))

	const workers: WorkerStateType[] = []
	const queue: PendingJobType[] = []
	let nextJobId = 1
	let shuttingDown = false
	let consecutiveCrashes = 0
	let warmRefillTimer: ReturnType<typeof setTimeout> | null = null

	const idleWorker = (): WorkerStateType | undefined =>
		workers.find(
			(w) => w.ready && !w.currentJob && !w.recycling && !w.sessionHeld,
		)

	const busyCount = (): number =>
		workers.filter((w) => w.currentJob !== null || w.sessionHeld).length

	const scheduleIdleReap = (ws: WorkerStateType): void => {
		if (ws.idleTimer) clearTimeout(ws.idleTimer)
		ws.idleTimer = null
		if (workers.length <= warmWorkers) return
		ws.idleTimer = setTimeout(() => {
			if (shuttingDown || ws.currentJob || ws.recycling) return
			if (workers.length <= warmWorkers) return
			ws.recycling = true
			inferencePoolLogger.info(`♻️ ${label} reaping idle worker`, {
				workers: workers.length,
				warmWorkers,
			})
			ws.handle.send({ type: "shutdown" })
		}, idleTimeoutMs)
	}

	const spawnWorker = (): WorkerStateType => {
		const ws: WorkerStateType = {
			handle: backend.spawn(),
			ready: false,
			jobs: 0,
			recycling: false,
			sessionHeld: false,
			idleTimer: null,
			currentJob: null,
		}
		workers.push(ws)
		ws.handle.onMessage((msg) => {
			if (msg.type === "ready") {
				ws.ready = true
				consecutiveCrashes = 0
				pump()
				return
			}
			if (msg.type === "result") {
				finishJob(ws, msg.id, null, msg.result)
				return
			}
			if (msg.type === "error") {
				finishJob(ws, msg.id, new Error(msg.message), null)
			}
		})
		ws.handle.onExit((code) => onWorkerExit(ws, code))
		return ws
	}

	const removeWorker = (ws: WorkerStateType): void => {
		const i = workers.indexOf(ws)
		if (i >= 0) workers.splice(i, 1)
		if (ws.idleTimer) clearTimeout(ws.idleTimer)
	}

	const refillWarmFloor = (): void => {
		if (shuttingDown) return
		while (workers.length < warmWorkers) spawnWorker()
		pump()
	}

	const onWorkerExit = (ws: WorkerStateType, code: number | null): void => {
		removeWorker(ws)
		if (ws.currentJob) {
			const { pending, execTimer } = ws.currentJob
			if (execTimer) clearTimeout(execTimer)
			ws.currentJob = null
			pending.reject(new Error(`${label} worker exited (code ${code})`))
		}
		if (shuttingDown) return

		const crashed = !ws.recycling && code !== 0
		if (!crashed) {
			consecutiveCrashes = 0
			refillWarmFloor()
			return
		}

		consecutiveCrashes++
		if (consecutiveCrashes > RESPAWN_MAX_ATTEMPTS) {
			inferencePoolLogger.error(
				`💀 ${label} worker crashed ${consecutiveCrashes}× — pausing warm respawn (jobs lazy-spawn on demand)`,
				{ code },
			)
			pump()
			return
		}
		const delay = Math.min(
			RESPAWN_BACKOFF_MAX_MS,
			RESPAWN_BACKOFF_BASE_MS * 2 ** (consecutiveCrashes - 1),
		)
		inferencePoolLogger.warn(`💥 ${label} worker crashed — respawning`, {
			code,
			attempt: consecutiveCrashes,
			delayMs: delay,
			workers: workers.length,
		})
		if (warmRefillTimer) return
		warmRefillTimer = setTimeout(() => {
			warmRefillTimer = null
			refillWarmFloor()
		}, delay)
	}

	const finishJob = (
		ws: WorkerStateType,
		id: number,
		err: Error | null,
		result: unknown,
	): void => {
		const job = ws.currentJob
		ws.currentJob = null
		ws.jobs++
		if (job?.execTimer) clearTimeout(job.execTimer)
		if (job && job.id === id) {
			if (err) job.pending.reject(err)
			else job.pending.resolve(result)
		}
		if (ws.sessionHeld) {
			pump()
			return
		}
		if (recycleAfterJobs > 0 && ws.jobs >= recycleAfterJobs) {
			ws.recycling = true
			ws.handle.send({ type: "shutdown" })
		} else {
			scheduleIdleReap(ws)
		}
		pump()
	}

	const assign = (ws: WorkerStateType, pending: PendingJobType): void => {
		if (ws.idleTimer) {
			clearTimeout(ws.idleTimer)
			ws.idleTimer = null
		}
		if (pending.timer) {
			clearTimeout(pending.timer)
			pending.timer = null
		}
		const id = nextJobId++
		const execTimer =
			executionTimeoutMs > 0
				? setTimeout(() => {
						if (ws.currentJob?.id !== id) return
						inferencePoolLogger.error(
							`⏱️ ${label} job exceeded ${executionTimeoutMs}ms — killing hung worker`,
							{ jobId: id },
						)
						ws.handle.kill()
					}, executionTimeoutMs)
				: null
		ws.currentJob = { id, pending, execTimer }
		const sent = ws.handle.send({ type: "job", id, payload: pending.payload })
		if (!sent) {
			if (execTimer) clearTimeout(execTimer)
			ws.currentJob = null
			pending.reject(poolBusyError(`${label} worker channel closed`))
			inferencePoolLogger.warn(`💥 ${label} send failed — killing worker`)
			ws.handle.kill()
		}
	}

	const pump = (): void => {
		while (queue.length > 0) {
			const ws = idleWorker()
			if (ws) {
				const pending = queue.shift()
				if (!pending) return
				assign(ws, pending)
				continue
			}
			const spawning = workers.some((w) => !w.ready && !w.recycling)
			if (!spawning && workers.length < maxWorkers) {
				spawnWorker()
			}
			return
		}
	}

	const submit = <T>(payload: unknown): Promise<T> => {
		if (shuttingDown) {
			return Promise.reject(poolBusyError(`${label} pool is shutting down`))
		}
		if (queue.length >= queueMaxDepth) {
			return Promise.reject(poolBusyError(`${label} pool queue is full`))
		}
		return new Promise<T>((resolve, reject) => {
			const pending: PendingJobType = {
				payload,
				resolve: resolve as (result: unknown) => void,
				reject,
				timer: null,
			}
			if (queueTimeoutMs > 0) {
				pending.timer = setTimeout(() => {
					const i = queue.indexOf(pending)
					if (i >= 0) queue.splice(i, 1)
					reject(poolBusyError(`${label} pool queue timed out`))
				}, queueTimeoutMs)
			}
			queue.push(pending)
			pump()
		})
	}

	const acquireSession = (): PoolSessionType => {
		if (shuttingDown) throw poolBusyError(`${label} pool is shutting down`)
		let ws = idleWorker()
		if (!ws && workers.length < maxWorkers) ws = spawnWorker()
		if (!ws) throw poolBusyError(`${label} pool has no worker for a session`)
		ws.sessionHeld = true
		if (ws.idleTimer) {
			clearTimeout(ws.idleTimer)
			ws.idleTimer = null
		}
		const held = ws
		let released = false
		let chain: Promise<unknown> = Promise.resolve()

		const exchangeOne = <T>(payload: unknown): Promise<T> => {
			if (released || shuttingDown || !workers.includes(held)) {
				return Promise.reject(poolBusyError(`${label} session worker is gone`))
			}
			if (!held.ready) {
				return new Promise<T>((resolve, reject) => {
					const poll = setInterval(() => {
						if (!workers.includes(held)) {
							clearInterval(poll)
							reject(poolBusyError(`${label} session worker died`))
							return
						}
						if (held.ready) {
							clearInterval(poll)
							exchangeOne<T>(payload).then(resolve, reject)
						}
					}, 20)
				})
			}
			return new Promise<T>((resolve, reject) => {
				assign(held, {
					payload,
					resolve: resolve as (result: unknown) => void,
					reject,
					timer: null,
				})
			})
		}

		const exchange = <T>(payload: unknown): Promise<T> => {
			const next = chain.then(
				() => exchangeOne<T>(payload),
				() => exchangeOne<T>(payload),
			)
			chain = next.catch(() => undefined)
			return next
		}

		return {
			exchange,
			release: () => {
				if (released) return
				released = true
				held.sessionHeld = false
				if (workers.includes(held)) {
					if (recycleAfterJobs > 0 && held.jobs >= recycleAfterJobs) {
						held.recycling = true
						held.handle.send({ type: "shutdown" })
					} else {
						scheduleIdleReap(held)
					}
				}
				pump()
			},
		}
	}

	const shutdown = async (): Promise<void> => {
		shuttingDown = true
		if (warmRefillTimer) {
			clearTimeout(warmRefillTimer)
			warmRefillTimer = null
		}
		for (const pending of queue.splice(0)) {
			if (pending.timer) clearTimeout(pending.timer)
			pending.reject(poolBusyError(`${label} pool shut down`))
		}
		for (const ws of [...workers]) {
			if (ws.idleTimer) clearTimeout(ws.idleTimer)
			ws.handle.send({ type: "shutdown" })
		}
	}

	for (let i = 0; i < Math.max(0, warmWorkers); i++) spawnWorker()

	return {
		submit,
		acquireSession,
		activeWorkers: () => workers.length,
		busyWorkers: busyCount,
		queuedJobs: () => queue.length,
		shutdown,
	}
}
