import { DomiaType } from "@/modules/core"

export const runLlamaCpp = async (domia: DomiaType, promptContext: string) => {
	return `${domia?.name} ${promptContext}`
}
