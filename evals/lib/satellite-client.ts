import WebSocket from "ws"
import { env } from "./env"
import { fabricateSegmentPcm } from "./fake-audio"
import { parseWavPcm } from "./wav"
import type {
	SatelliteTurnOptionsType,
	SatelliteTurnResultType,
} from "../types"

const defaultWsUrl = (): string =>
	`${env.EVAL_URL.replace(/^http/, "ws")}/satellite`

export const satelliteTurn = (
	satelliteId: string,
	wavPath: string,
	opts: SatelliteTurnOptionsType = {},
): Promise<SatelliteTurnResultType> =>
	new Promise((resolve) => {
		const { pcm, sampleRate, channels } = parseWavPcm(wavPath)
		const ws = new WebSocket(opts.wsUrl ?? defaultWsUrl())
		const result: SatelliteTurnResultType = {
			ready: false,
			transcript: null,
			audioBegan: false,
			audioFrames: 0,
			audioEnded: false,
			pauses: 0,
			resumes: 0,
			replyDone: null,
			error: null,
		}
		const finish = (): void => {
			clearTimeout(timer)
			try {
				ws.close()
			} catch {
				/* already closed */
			}
			resolve(result)
		}
		const timer = setTimeout(finish, 60_000)
		ws.on("open", () => {
			const token = opts.token ?? env.DOMIA_MESH_SECRET
			ws.send(
				JSON.stringify({
					type: "hello",
					satelliteId,
					domiaKey: env.EVAL_DOMIA_KEY,
					sampleRate,
					channels,
					...(token !== undefined ? { token } : {}),
				}),
			)
		})
		let bargeInStarted = false
		const runBargeIn = async (): Promise<void> => {
			const cfg = opts.bargeIn
			if (!cfg || bargeInStarted) return
			bargeInStarted = true
			const frameMs = 200
			const frameBytes = Math.round(
				(sampleRate * channels * 2 * frameMs) / 1000,
			)
			const speech = fabricateSegmentPcm("speech", cfg.speechMs, sampleRate)
			for (let i = 0; i < speech.length; i += frameBytes) {
				ws.send(speech.subarray(i, Math.min(i + frameBytes, speech.length)))
				await new Promise((r) => setTimeout(r, frameMs))
			}
			const silence = Buffer.alloc(frameBytes)
			for (let ms = 0; ms < (cfg.thenSilenceMs ?? 0); ms += frameMs) {
				ws.send(silence)
				await new Promise((r) => setTimeout(r, frameMs))
			}
		}
		let replyRate = sampleRate
		let audioInteractionId: string | undefined
		const echoBack = (frame: Buffer): void => {
			const ratio = replyRate / sampleRate
			const inSamples = frame.length >> 1
			const outSamples = Math.floor(inSamples / ratio)
			const out = Buffer.alloc(outSamples * 2)
			for (let i = 0; i < outSamples; i++)
				out.writeInt16LE(frame.readInt16LE(Math.floor(i * ratio) << 1), i << 1)
			ws.send(out)
		}
		ws.on("message", (data, isBinary) => {
			if (isBinary) {
				result.audioFrames++
				if (result.audioFrames === 1)
					ws.send(
						JSON.stringify({
							type: "audio_played",
							...(audioInteractionId
								? { interactionId: audioInteractionId }
								: {}),
						}),
					)
				if (opts.echoLoopback) echoBack(Buffer.from(data as Buffer))
				if (
					opts.bargeIn &&
					result.audioFrames === (opts.bargeIn.afterFrames ?? 3)
				)
					void runBargeIn()
				return
			}
			const msg = JSON.parse(data.toString()) as {
				type: string
				text?: string
				reply?: string
				interactionId?: string
				message?: string
			}
			if (msg.type === "ready") {
				result.ready = true
				const frame = sampleRate * channels * 2 * 0.2
				for (let i = 0; i < pcm.length; i += frame) {
					ws.send(pcm.subarray(i, Math.min(i + frame, pcm.length)))
				}
				ws.send(JSON.stringify({ type: "speech_end" }))
				if (opts.disconnectAfterSpeechEnd) {
					setTimeout(() => {
						ws.terminate()
						setTimeout(finish, 100)
					}, 150)
				}
			} else if (msg.type === "transcript") {
				result.transcript = msg.text ?? ""
				if (opts.bargeIn && (opts.bargeIn.afterFrames ?? 3) === 0)
					void runBargeIn()
			} else if (msg.type === "audio_stream_begin") {
				result.audioBegan = true
				replyRate = (msg as { sampleRate?: number }).sampleRate ?? replyRate
				audioInteractionId = (msg as { interactionId?: string }).interactionId
				if (opts.bargeIn && (opts.bargeIn.afterFrames ?? 3) === 0)
					void runBargeIn()
			} else if (msg.type === "audio_stream_end") result.audioEnded = true
			else if (msg.type === "audio_pause") result.pauses += 1
			else if (msg.type === "audio_resume") result.resumes += 1
			else if (msg.type === "reply_done") {
				result.replyDone = {
					reply: msg.reply ?? "",
					interactionId: msg.interactionId ?? "",
				}
				finish()
			} else if (msg.type === "error") {
				result.error = msg.message ?? "unknown"
				finish()
			}
		})
		ws.on("error", (err) => {
			result.error = String(err)
			finish()
		})
		ws.on("close", () => {
			if (!result.replyDone && !opts.disconnectAfterSpeechEnd) finish()
		})
	})
