import { transcribeSttJob } from "@/modules/stt-engine/utils/inference"
import type { SttWorkerJobType } from "@/modules/stt-engine/types"
import type {
	WorkerRequestMessageType,
	WorkerResponseMessageType,
} from "../types"

const send = (msg: WorkerResponseMessageType): void => {
	if (!process.send) return
	process.send(msg, undefined, undefined, () => undefined)
}

process.on("disconnect", () => process.exit(0))

process.on("message", (msg: WorkerRequestMessageType) => {
	if (!msg || typeof msg !== "object") return
	if (msg.type === "shutdown") {
		process.exit(0)
	}
	if (msg.type === "job") {
		try {
			const result = transcribeSttJob(msg.payload as SttWorkerJobType)
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
