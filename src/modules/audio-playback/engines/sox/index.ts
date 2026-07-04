import { spawn, type ChildProcess } from "child_process"

import { type DomiaType } from "@/modules/core"
import { DEFAULT_PLAYBACK_WATCHDOG_GRACE_MS } from "@/db"
import { audioPlaybackLogger } from "@/utils"
import { registerActivePlayback } from "../../utils"
import type { AudioPlaybackResult, SoxStreamOptionsType } from "../../types"

const STREAM_BUFFER_BYTES = 65536
const KILL_GRACE_MS = 2000
const PREWARM_TTL_MS = 15000
const STDERR_NOISE_PATTERN = /can't set sample rate/

const volumeFromConfig = (
	config: DomiaType["audioPlaybackConfig"],
): { volume: number; factor: number } => {
	const volume = config?.volume ?? 100
	return { volume, factor: volume / 100 }
}

const appendVolArgs = (args: string[], factor: number): string[] =>
	factor === 1 ? args : [...args, "vol", factor.toString()]

const buildStreamPlayArgs = (
	options: SoxStreamOptionsType,
	volumeFactor: number,
): string[] => {
	const args = [
		"--buffer",
		String(STREAM_BUFFER_BYTES),
		"-t",
		"raw",
		"-r",
		String(options.sampleRate),
		"-e",
		"signed",
		"-b",
		String(options.bitsPerSample),
		"-c",
		String(options.channels),
		"-q",
		"-",
	]
	return appendVolArgs(args, volumeFactor)
}

const attachStderrFilter = (
	proc: { stderr?: NodeJS.ReadableStream | null },
	domiaId: string,
): void => {
	proc.stderr?.on("data", (buf: Buffer) => {
		const msg = buf.toString().trim()
		if (!msg || STDERR_NOISE_PATTERN.test(msg)) return
		audioPlaybackLogger.warn(`[sox stderr]: ${msg}`, { domiaId })
	})
}

const waitDrainOrExit = (
	proc: ChildProcess,
	stallBudgetMs: number,
	onStall: () => void,
): Promise<void> =>
	new Promise<void>((resolve) => {
		let stallTimer: ReturnType<typeof setTimeout> | null = null
		const finish = (): void => {
			if (stallTimer) clearTimeout(stallTimer)
			proc.stdin?.off("drain", finish)
			proc.off("exit", finish)
			proc.stdin?.off("close", finish)
			resolve()
		}
		if (stallBudgetMs > 0) {
			stallTimer = setTimeout(onStall, stallBudgetMs)
			stallTimer.unref()
		}
		proc.stdin?.once("drain", finish)
		proc.once("exit", finish)
		proc.stdin?.once("close", finish)
	})

const bytesToAudioMs = (
	bytes: number,
	sampleRate: number,
	channels: number,
	bitsPerSample: number,
): number => {
	const bytesPerSec = sampleRate * channels * (bitsPerSample / 8)
	return Math.round((bytes / bytesPerSec) * 1000)
}

export const runSox = async (
	domia: DomiaType,
	filePath: string,
): Promise<AudioPlaybackResult> => {
	const { volume, factor } = volumeFromConfig(domia.audioPlaybackConfig)
	const args = appendVolArgs([filePath], factor)

	audioPlaybackLogger.info("🔊 Running Sox playback", {
		domiaId: domia?.id,
		filePath,
		engine: "sox",
		volume,
	})

	return new Promise((resolve, reject) => {
		const proc = spawn("play", args, { stdio: "ignore" })
		let interrupted = false
		let killTimer: ReturnType<typeof setTimeout> | null = null
		const clearKillTimer = (): void => {
			if (killTimer) {
				clearTimeout(killTimer)
				killTimer = null
			}
		}
		const unregister = registerActivePlayback(domia.id, () => {
			interrupted = true
			audioPlaybackLogger.info("🛑 Sox playback interrupted", {
				domiaId: domia.id,
			})
			proc.kill("SIGTERM")
			killTimer = setTimeout(() => {
				killTimer = null
				try {
					proc.kill("SIGKILL")
				} catch {
					/* */
				}
			}, KILL_GRACE_MS)
			killTimer.unref()
		})

		proc.on("error", (err) => {
			clearKillTimer()
			unregister()
			audioPlaybackLogger.error("🔇 Sox error", { err, domiaId: domia.id })
			reject(err)
		})

		proc.on("exit", (code) => {
			clearKillTimer()
			unregister()
			if (interrupted) {
				resolve({ engine: "SOX", success: true, interrupted: true })
				return
			}
			if (code === 0) {
				resolve({ engine: "SOX", success: true })
				return
			}
			audioPlaybackLogger.error("🔇 Sox failed", { code, domiaId: domia.id })
			resolve({ engine: "SOX", success: false })
		})
	})
}

const prewarmedPlayers = new Map<
	string,
	{ proc: ChildProcess; args: string[]; timer: ReturnType<typeof setTimeout> }
>()

const killDetachedProc = (proc: ChildProcess): void => {
	const signal = (sig: NodeJS.Signals): void => {
		try {
			if (proc.pid) process.kill(-proc.pid, sig)
			else proc.kill(sig)
		} catch {
			try {
				proc.kill(sig)
			} catch {
				/* */
			}
		}
	}
	signal("SIGTERM")
	const killTimer = setTimeout(() => {
		if (proc.exitCode === null && proc.signalCode === null) signal("SIGKILL")
	}, KILL_GRACE_MS)
	killTimer.unref()
}

const killPrewarmed = (domiaId: string): void => {
	const entry = prewarmedPlayers.get(domiaId)
	if (!entry) return
	prewarmedPlayers.delete(domiaId)
	clearTimeout(entry.timer)
	killDetachedProc(entry.proc)
}

const takePrewarmedPlayer = (
	domiaId: string,
	args: string[],
): ChildProcess | null => {
	const entry = prewarmedPlayers.get(domiaId)
	if (!entry) return null
	prewarmedPlayers.delete(domiaId)
	clearTimeout(entry.timer)
	const compatible =
		entry.args.join("\u0000") === args.join("\u0000") &&
		entry.proc.exitCode === null &&
		entry.proc.stdin?.writable === true
	if (compatible) {
		entry.proc.removeAllListeners("error")
		entry.proc.removeAllListeners("exit")
		entry.proc.stderr?.removeAllListeners("data")
		audioPlaybackLogger.info("🔊 adopting prewarmed player", { domiaId })
		return entry.proc
	}
	killDetachedProc(entry.proc)
	return null
}

export const prewarmSoxPlayer = (
	domia: DomiaType,
	options: SoxStreamOptionsType,
): void => {
	const domiaId = domia.id
	if (prewarmedPlayers.has(domiaId)) return
	const { factor } = volumeFromConfig(domia.audioPlaybackConfig)
	const args = buildStreamPlayArgs(options, factor)
	try {
		const proc = spawn("play", args, {
			stdio: ["pipe", "ignore", "pipe"],
			detached: true,
		})
		proc.on("error", () => killPrewarmed(domiaId))
		proc.on("exit", () => {
			const entry = prewarmedPlayers.get(domiaId)
			if (entry?.proc === proc) {
				clearTimeout(entry.timer)
				prewarmedPlayers.delete(domiaId)
			}
		})
		attachStderrFilter(proc, domiaId)
		const timer = setTimeout(() => killPrewarmed(domiaId), PREWARM_TTL_MS)
		timer.unref()
		prewarmedPlayers.set(domiaId, { proc, args, timer })
		audioPlaybackLogger.info("🔊 prewarmed player spawned (device opening)", {
			domiaId,
		})
	} catch (err) {
		audioPlaybackLogger.warn("prewarm player spawn failed", { domiaId, err })
	}
}

export const runSoxStream = async (
	domia: DomiaType,
	chunks: AsyncIterable<Buffer>,
	options: SoxStreamOptionsType,
): Promise<AudioPlaybackResult> => {
	const { volume, factor } = volumeFromConfig(domia.audioPlaybackConfig)
	const playArgs = buildStreamPlayArgs(options, factor)

	audioPlaybackLogger.info("🔊 Running Sox stream playback", {
		domiaId: domia?.id,
		sampleRate: options.sampleRate,
		channels: options.channels,
		bitsPerSample: options.bitsPerSample,
		volume,
	})

	return new Promise<AudioPlaybackResult>((resolve, reject) => {
		const proc =
			takePrewarmedPlayer(domia.id, playArgs) ??
			spawn("play", playArgs, {
				stdio: ["pipe", "ignore", "pipe"],
				detached: true,
			})
		const iterator = chunks[Symbol.asyncIterator]()

		const state = {
			settled: false,
			pumpDone: false,
			exited: false,
			exitCode: null as number | null,
			pumpError: null as Error | null,
			firstChunkWritten: false,
			firstChunkAt: 0,
			interrupted: false,
			watchdogTripped: false,
			totalBytes: 0,
			chunkCount: 0,
			startedAt: Date.now(),
		}
		const watchdogGraceMs =
			domia.audioPlaybackConfig?.watchdogGraceMs ??
			DEFAULT_PLAYBACK_WATCHDOG_GRACE_MS
		let watchdogTimer: ReturnType<typeof setTimeout> | null = null
		const clearWatchdogTimer = (): void => {
			if (watchdogTimer) {
				clearTimeout(watchdogTimer)
				watchdogTimer = null
			}
		}

		let killTimer: ReturnType<typeof setTimeout> | null = null
		const clearKillTimer = (): void => {
			if (killTimer) {
				clearTimeout(killTimer)
				killTimer = null
			}
		}
		const signalGroup = (signal: NodeJS.Signals): void => {
			try {
				if (proc.pid) process.kill(-proc.pid, signal)
				else proc.kill(signal)
			} catch {
				try {
					proc.kill(signal)
				} catch {
					/* */
				}
			}
		}
		const killProcessGroup = (): void => {
			signalGroup("SIGTERM")
			if (killTimer) return
			killTimer = setTimeout(() => {
				killTimer = null
				if (!state.exited) signalGroup("SIGKILL")
			}, KILL_GRACE_MS)
			killTimer.unref()
		}

		const tripWatchdog = (reason: string): void => {
			if (state.settled || state.exited || state.interrupted) return
			if (state.watchdogTripped) return
			state.watchdogTripped = true
			audioPlaybackLogger.error(
				"🐕 Playback watchdog tripped — audio device not consuming, killing player",
				{
					domiaId: domia.id,
					reason,
					totalBytes: state.totalBytes,
					elapsedMs: Date.now() - state.startedAt,
					expectedAudioMs: bytesToAudioMs(
						state.totalBytes,
						options.sampleRate,
						options.channels,
						options.bitsPerSample,
					),
				},
			)
			killProcessGroup()
			proc.stdin?.destroy()
			void iterator.return?.(undefined)
		}

		const unregister = registerActivePlayback(domia.id, () => {
			state.interrupted = true
			audioPlaybackLogger.info("🛑 Sox stream playback interrupted", {
				domiaId: domia.id,
			})
			killProcessGroup()
			proc.stdin?.destroy()
			void iterator.return?.(undefined)
		})

		const settle = (result: AudioPlaybackResult, err?: Error): void => {
			if (state.settled) return
			state.settled = true
			clearKillTimer()
			clearWatchdogTimer()
			unregister()
			if (err) reject(err)
			else resolve(result)
		}

		const tryFinish = (): void => {
			if (!state.pumpDone || !state.exited) return
			audioPlaybackLogger.info("🔊 Sox stream playback finished", {
				domiaId: domia.id,
				exitCode: state.exitCode,
				totalBytes: state.totalBytes,
				chunkCount: state.chunkCount,
				elapsedMs: Date.now() - state.startedAt,
				expectedAudioMs: bytesToAudioMs(
					state.totalBytes,
					options.sampleRate,
					options.channels,
					options.bitsPerSample,
				),
			})
			if (state.interrupted) {
				settle({ engine: "SOX", success: true, interrupted: true })
				return
			}
			if (state.watchdogTripped) {
				settle(
					{ engine: "SOX", success: false },
					new Error("playback watchdog: audio device not consuming"),
				)
				return
			}
			if (state.pumpError) {
				settle({ engine: "SOX", success: false }, state.pumpError)
				return
			}
			settle({ engine: "SOX", success: state.exitCode === 0 })
		}

		attachStderrFilter(proc, domia.id)

		proc.stdin?.on("error", (err) => {
			const code = (err as NodeJS.ErrnoException).code
			if (code === "EPIPE") {
				audioPlaybackLogger.warn("🔇 Sox stdin EPIPE (sox exited early)", {
					domiaId: domia.id,
				})
				return
			}
			audioPlaybackLogger.error("🔇 Sox stdin error", {
				err,
				code,
				domiaId: domia.id,
			})
		})

		proc.on("error", (err) => {
			audioPlaybackLogger.error("🔇 Sox stream process error", {
				err,
				domiaId: domia.id,
			})
			settle({ engine: "SOX", success: false }, err)
		})

		proc.on("exit", (code) => {
			state.exited = true
			state.exitCode = code ?? null
			clearKillTimer()
			if (code !== 0 && !state.interrupted) {
				audioPlaybackLogger.error("🔇 Sox stream failed", {
					code,
					domiaId: domia.id,
					totalBytes: state.totalBytes,
				})
			}
			tryFinish()
		})

		const pump = async (): Promise<void> => {
			try {
				for (
					let next = await iterator.next();
					!next.done;
					next = await iterator.next()
				) {
					const chunk = next.value
					if (state.exited) {
						audioPlaybackLogger.warn(
							"🔇 Sox exited while pump still has chunks",
							{
								domiaId: domia.id,
								chunksConsumed: state.chunkCount,
								bytesConsumed: state.totalBytes,
							},
						)
						break
					}
					if (!proc.stdin || !proc.stdin.writable) {
						audioPlaybackLogger.warn(
							"🔇 Sox stdin not writable, breaking pump",
							{ domiaId: domia.id, chunksConsumed: state.chunkCount },
						)
						break
					}

					const okWrite = proc.stdin.write(chunk)
					state.totalBytes += chunk.length
					state.chunkCount++
					if (!state.firstChunkWritten) {
						state.firstChunkWritten = true
						state.firstChunkAt = Date.now()
						options.onFirstChunkWritten?.()
					}
					if (!okWrite) {
						const bufferedAheadMs = state.firstChunkAt
							? Math.max(
									0,
									bytesToAudioMs(
										state.totalBytes,
										options.sampleRate,
										options.channels,
										options.bitsPerSample,
									) -
										(Date.now() - state.firstChunkAt),
								)
							: 0
						const stallBudgetMs =
							watchdogGraceMs > 0
								? watchdogGraceMs +
									Math.max(
										bytesToAudioMs(
											STREAM_BUFFER_BYTES,
											options.sampleRate,
											options.channels,
											options.bitsPerSample,
										),
										bufferedAheadMs,
									)
								: 0
						await waitDrainOrExit(proc, stallBudgetMs, () =>
							tripWatchdog("stdin stalled — no drain within budget"),
						)
					}
				}
			} catch (err) {
				state.pumpError = err instanceof Error ? err : new Error(String(err))
				audioPlaybackLogger.error("🔇 Sox stream pump error", {
					err,
					domiaId: domia.id,
				})
			} finally {
				state.pumpDone = true
				void iterator.return?.(undefined)
				try {
					if (proc.stdin && !proc.stdin.destroyed) proc.stdin.end()
				} catch {
					/* */
				}
				if (watchdogGraceMs > 0 && !state.exited && !state.settled) {
					const deadlineMs =
						bytesToAudioMs(
							state.totalBytes,
							options.sampleRate,
							options.channels,
							options.bitsPerSample,
						) + watchdogGraceMs
					clearWatchdogTimer()
					watchdogTimer = setTimeout(
						() => tripWatchdog("player did not exit by audio deadline"),
						deadlineMs,
					)
					watchdogTimer.unref()
				}
				tryFinish()
			}
		}

		void pump()
	})
}
