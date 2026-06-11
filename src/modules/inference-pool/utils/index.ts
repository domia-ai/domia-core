import { fork } from "child_process"
import os from "os"
import path from "path"

import {
	AUTO_MAX_WORKERS_FLOOR,
	AUTO_MAX_WORKERS_CEILING,
	AUTO_CORE_DIVISOR,
	AUTO_GB_PER_WORKER,
} from "../constants"
import type {
	WorkerBackendType,
	WorkerHandleType,
	WorkerRequestMessageType,
	WorkerResponseMessageType,
	InferencePoolType,
} from "../types"

export const drainAndShutdown = async (
	pool: InferencePoolType,
	timeoutMs: number,
): Promise<void> => {
	const deadline = Date.now() + timeoutMs
	while (pool.busyWorkers() + pool.queuedJobs() > 0 && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
	await pool.shutdown()
}

const isTsRuntime = __filename.endsWith(".ts")

const workerEntry = (entryBaseName: string): string => {
	const ext = isTsRuntime ? "ts" : "js"
	return path.resolve(__dirname, "../worker", `${entryBaseName}.${ext}`)
}

const workerExecArgv = (): string[] =>
	isTsRuntime
		? ["-r", "ts-node/register/transpile-only", "-r", "tsconfig-paths/register"]
		: []

export const createChildProcessBackend = (
	entryBaseName: string,
): WorkerBackendType => {
	const entry = workerEntry(entryBaseName)
	const execArgv = workerExecArgv()
	return {
		spawn: (): WorkerHandleType => {
			const child = fork(entry, [], {
				execArgv,
				serialization: "advanced",
			})
			return {
				send: (msg: WorkerRequestMessageType): boolean => {
					if (!child.connected) return false
					try {
						// send() === false is IPC backpressure, not a closed channel — the message still queues
						child.send(msg, undefined, undefined, () => undefined)
						return true
					} catch {
						return false
					}
				},
				kill: (): void => {
					child.kill()
				},
				onMessage: (cb: (msg: WorkerResponseMessageType) => void): void => {
					child.on("message", (msg) => cb(msg as WorkerResponseMessageType))
				},
				onExit: (cb: (code: number | null) => void): void => {
					child.on("exit", cb)
				},
			}
		},
	}
}

const reservedByLabel = new Map<string, number>()

export const resolveMaxWorkers = (
	configured: number,
	label = "default",
): number => {
	const totalGb = os.totalmem() / 1024 ** 3
	const ramBudget = Math.max(1, Math.floor(totalGb / AUTO_GB_PER_WORKER))
	if (configured > 0) {
		reservedByLabel.set(label, configured)
		return configured
	}
	const cores = os.cpus().length || AUTO_MAX_WORKERS_FLOOR
	const coresBased = Math.floor(cores / AUTO_CORE_DIVISOR)
	const reservedElsewhere = [...reservedByLabel.entries()]
		.filter(([key]) => key !== label)
		.reduce((sum, [, value]) => sum + value, 0)
	const ramRemaining = Math.max(1, ramBudget - reservedElsewhere)
	const derived = Math.min(coresBased, ramRemaining)
	const resolved = Math.max(1, Math.min(AUTO_MAX_WORKERS_CEILING, derived))
	reservedByLabel.set(label, resolved)
	return resolved
}

export const poolBusyError = (message: string): Error => {
	const err = new Error(message) as Error & { code?: string }
	err.code = "INFERENCE_POOL_BUSY"
	return err
}
