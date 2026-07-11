import WebSocket from "ws"
import { env } from "./env"
import { parseWavPcm } from "./wav"
import type { RealtimeTurnOptionsType, RealtimeTurnResultType } from "../types"

const defaultWsUrl = (): string =>
	`${env.EVAL_URL.replace(/^http/, "ws")}/v1/realtime?model=${env.EVAL_DOMIA_KEY}`

const SILENCE_TAIL_MS = 2500

export const realtimeTurn = (
	wavPath: string,
	opts: RealtimeTurnOptionsType = {},
): Promise<RealtimeTurnResultType> =>
	new Promise((resolve) => {
		const { pcm, sampleRate, channels } = parseWavPcm(wavPath)
		const serverVad = opts.serverVad ?? false
		const ws = new WebSocket(opts.wsUrl ?? defaultWsUrl(), {
			headers: { authorization: `Bearer ${env.DOMIA_MESH_SECRET}` },
		})
		const result: RealtimeTurnResultType = {
			sessionCreated: false,
			speechStopped: false,
			transcript: null,
			responseCreated: false,
			audioDeltas: 0,
			audioDone: false,
			replyText: null,
			responseDone: false,
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
		const sendAudio = async (): Promise<void> => {
			const frame = sampleRate * channels * 2 * 0.2
			for (let i = 0; i < pcm.length; i += frame) {
				ws.send(
					JSON.stringify({
						type: "input_audio_buffer.append",
						audio: pcm
							.subarray(i, Math.min(i + frame, pcm.length))
							.toString("base64"),
					}),
				)
			}
			if (serverVad) {
				const silenceFrame = Buffer.alloc(frame)
				const tailFrames = Math.ceil(SILENCE_TAIL_MS / 200)
				for (let i = 0; i < tailFrames; i++) {
					if (ws.readyState !== ws.OPEN) return
					ws.send(
						JSON.stringify({
							type: "input_audio_buffer.append",
							audio: silenceFrame.toString("base64"),
						}),
					)
					await new Promise((r) => setTimeout(r, 200))
				}
			} else {
				ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }))
			}
		}
		ws.on("message", (data) => {
			const msg = JSON.parse(data.toString()) as {
				type: string
				transcript?: string
				delta?: string
				error?: { message?: string }
			}
			if (msg.type === "session.created") {
				result.sessionCreated = true
				ws.send(
					JSON.stringify({
						type: "session.update",
						session: {
							turn_detection: serverVad ? { type: "server_vad" } : null,
							audio: {
								input: { format: { type: "audio/pcm", rate: sampleRate } },
							},
						},
					}),
				)
			} else if (msg.type === "session.updated") void sendAudio()
			else if (msg.type === "input_audio_buffer.speech_stopped")
				result.speechStopped = true
			else if (
				msg.type === "conversation.item.input_audio_transcription.completed"
			)
				result.transcript = msg.transcript ?? ""
			else if (msg.type === "response.created") result.responseCreated = true
			else if (msg.type === "response.output_audio.delta")
				result.audioDeltas += 1
			else if (msg.type === "response.output_audio.done")
				result.audioDone = true
			else if (msg.type === "response.output_audio_transcript.done")
				result.replyText = msg.transcript ?? ""
			else if (msg.type === "response.done") {
				result.responseDone = true
				finish()
			} else if (msg.type === "error") {
				result.error = msg.error?.message ?? "unknown"
				finish()
			}
		})
		ws.on("error", (err) => {
			result.error = String(err)
			finish()
		})
		ws.on("close", () => {
			if (!result.responseDone) finish()
		})
	})
