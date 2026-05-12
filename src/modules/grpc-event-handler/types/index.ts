import type { DomiaType } from "@/modules/core"

export type GrpcEventHandlerContextType = {
	domia: DomiaType
}

export type DedupEntry = {
	timestamp: number
}
