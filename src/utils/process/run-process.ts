import { spawn } from "child_process"

import type { RunProcessOptionsType, RunProcessResultType } from "./types"

export const runProcess = (
	cmd: string,
	args: string[],
	options: RunProcessOptionsType,
): Promise<RunProcessResultType> =>
	new Promise((resolve) => {
		const captureStderr = options.captureStderr === true
		const child = spawn(cmd, args, {
			stdio: ["ignore", "pipe", captureStderr ? "pipe" : "ignore"],
		})
		let stdout = ""
		let stderr = ""
		let timedOut = false
		let settled = false
		const finish = (ok: boolean): void => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			resolve({ ok, stdout: stdout.trim(), stderr: stderr.trim(), timedOut })
		}
		const timer = setTimeout(() => {
			timedOut = true
			child.kill()
			finish(false)
		}, options.timeoutMs)
		timer.unref()
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString()
		})
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString()
		})
		child.on("error", (err) => {
			stderr = stderr || err.message
			finish(false)
		})
		child.on("close", (code) => finish(code === 0))
	})
