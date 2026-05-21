import { type DomiaType } from "@/modules/core"
import { type RuntimeCapabilitiesType } from "../environment"

export type GrpcServerArgsType = {
	domia: DomiaType
	capabilities: RuntimeCapabilitiesType
}
