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
} from "../types"

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
						return child.send(msg, undefined, undefined, () => undefined)
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

let globalReservedWorkers = 0

export const resolveMaxWorkers = (configured: number): number => {
	const totalGb = os.totalmem() / 1024 ** 3
	const ramBudget = Math.max(1, Math.floor(totalGb / AUTO_GB_PER_WORKER))
	if (configured > 0) {
		globalReservedWorkers += configured
		return configured
	}
	const cores = os.cpus().length || AUTO_MAX_WORKERS_FLOOR
	const coresBased = Math.floor(cores / AUTO_CORE_DIVISOR)
	const ramRemaining = Math.max(1, ramBudget - globalReservedWorkers)
	const derived = Math.min(coresBased, ramRemaining)
	const resolved = Math.max(1, Math.min(AUTO_MAX_WORKERS_CEILING, derived))
	globalReservedWorkers += resolved
	return resolved
}

export const poolBusyError = (message: string): Error => {
	const err = new Error(message) as Error & { code?: string }
	err.code = "INFERENCE_POOL_BUSY"
	return err
}
