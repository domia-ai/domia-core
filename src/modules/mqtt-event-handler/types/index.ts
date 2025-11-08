import { type DomiaType } from "@/modules/core"
import { type LoggerType } from "@/utils"

export type handleMqttMessageArgsType = {
	topic: string
	message: Buffer<ArrayBufferLike>
	logger: LoggerType
	domia: DomiaType
}
