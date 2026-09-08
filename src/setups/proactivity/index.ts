import { type DomiaType } from "@/modules/core"
import { startProactivity, stopProactivity } from "@/modules/proactivity"

export const setupProactivity = (domia: DomiaType): void => {
	startProactivity(domia)
}

export const teardownProactivity = (domiaKey: string): void => {
	stopProactivity(domiaKey)
}

export const reloadProactivity = (domia: DomiaType): void => {
	stopProactivity(domia.domiaKey)
	startProactivity(domia)
}
