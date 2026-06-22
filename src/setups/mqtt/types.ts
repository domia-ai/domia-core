import { type DomiaType } from "@/modules/core"
import { type SelectMqttConfigType } from "@/db"

export type SetupMqttArgsType = {
	domia: DomiaType
	config: SelectMqttConfigType | null
	nodeId?: string | null
}
