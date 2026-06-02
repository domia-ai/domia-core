import { fork } from "child_process"
import path from "path"

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
