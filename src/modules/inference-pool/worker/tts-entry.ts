import { synthesizeKokoroPcm } from "@/modules/tts-engine/engines/kokoro/inference"
import {
	synthesizePocketPcm,
	synthesizePocketPcmStream,
} from "@/modules/tts-engine/engines/pocket/inference"
import { synthesizeVitsPcm } from "@/modules/tts-engine/engines/vits/inference"
import { synthesizeKittenPcm } from "@/modules/tts-engine/engines/kitten/inference"
import { synthesizeMatchaPcm } from "@/modules/tts-engine/engines/matcha/inference"
import type {
	TtsWorkerJobType,
	TtsWorkerResultType,
} from "@/modules/tts-engine/types"
import type {
	WorkerRequestMessageType,
	WorkerResponseMessageType,
} from "../types"

const send = (msg: WorkerResponseMessageType): void => {
	if (!process.send) return
	process.send(msg, undefined, undefined, () => undefined)
}

const synthesize = (job: TtsWorkerJobType): TtsWorkerResultType => {
	switch (job.engine) {
		case "KOKORO":
			return synthesizeKokoroPcm(job)
		case "POCKET":
			return synthesizePocketPcm(job)
		case "VITS":
			return synthesizeVitsPcm(job)
		case "KITTEN":
			return synthesizeKittenPcm(job)
		case "MATCHA":
			return synthesizeMatchaPcm(job)
		default:
			throw new Error(
				`Unknown TTS engine: ${(job as { engine?: string }).engine}`,
			)
	}
}

process.on("disconnect", () => process.exit(0))

process.on("message", (msg: WorkerRequestMessageType) => {
	if (!msg || typeof msg !== "object") return
	if (msg.type === "shutdown") {
		process.exit(0)
	}
	if (msg.type === "job") {
		const job = msg.payload as TtsWorkerJobType
		if (job.engine === "POCKET" && job.stream === true) {
			void synthesizePocketPcmStream(job, (pcm) =>
				send({ type: "chunk", id: msg.id, chunk: pcm }),
			)
				.then((result) => send({ type: "result", id: msg.id, result }))
				.catch((err: unknown) =>
					send({
						type: "error",
						id: msg.id,
						message: err instanceof Error ? err.message : String(err),
					}),
				)
			return
		}
		try {
			const result = synthesize(job)
			send({ type: "result", id: msg.id, result })
		} catch (err) {
			send({
				type: "error",
				id: msg.id,
				message: err instanceof Error ? err.message : String(err),
			})
		}
	}
})

send({ type: "ready" })
