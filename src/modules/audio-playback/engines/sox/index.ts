import { spawn, type ChildProcess } from "child_process"

import { type DomiaType } from "@/modules/core"
import { audioPlaybackLogger } from "@/utils"
import type { AudioPlaybackResult, SoxStreamOptionsType } from "../../types"

const STREAM_BUFFER_BYTES = 65536
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

const waitDrainOrExit = (proc: ChildProcess): Promise<void> =>
	new Promise<void>((resolve) => {
		const finish = (): void => {
			proc.stdin?.off("drain", finish)
			proc.off("exit", finish)
			proc.stdin?.off("close", finish)
			resolve()
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

		proc.on("error", (err) => {
			audioPlaybackLogger.error("🔇 Sox error", { err, domiaId: domia.id })
			reject(err)
		})

		proc.on("exit", (code) => {
			if (code === 0) {
				resolve({ engine: "SOX", success: true })
				return
			}
			audioPlaybackLogger.error("🔇 Sox failed", { code, domiaId: domia.id })
			resolve({ engine: "SOX", success: false })
		})
	})
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

	const shellCommand = `cat | play ${playArgs.map((a) => `'${a}'`).join(" ")}`

	return new Promise<AudioPlaybackResult>((resolve, reject) => {
		const proc = spawn("bash", ["-c", shellCommand], {
			stdio: ["pipe", "ignore", "pipe"],
		})

		const state = {
			settled: false,
			pumpDone: false,
			exited: false,
			exitCode: null as number | null,
			pumpError: null as Error | null,
			firstChunkWritten: false,
			totalBytes: 0,
			chunkCount: 0,
			startedAt: Date.now(),
		}

		const settle = (result: AudioPlaybackResult, err?: Error): void => {
			if (state.settled) return
			state.settled = true
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
			if (code !== 0) {
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
				for await (const chunk of chunks) {
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
						options.onFirstChunkWritten?.()
					}
					if (!okWrite) await waitDrainOrExit(proc)
				}
			} catch (err) {
				state.pumpError = err instanceof Error ? err : new Error(String(err))
				audioPlaybackLogger.error("🔇 Sox stream pump error", {
					err,
					domiaId: domia.id,
				})
			} finally {
				state.pumpDone = true
				try {
					if (proc.stdin && !proc.stdin.destroyed) proc.stdin.end()
				} catch {
					/* */
				}
				tryFinish()
			}
		}

		void pump()
	})
}
