import type { LlmEngineEnumType } from "@/db"
import type { DomiaType } from "@/modules/core"

export type LlmCapabilitiesType = {
	streaming: boolean
}

export type LlmEngineAdapterType = {
	id: LlmEngineEnumType
	capabilities: LlmCapabilitiesType
	run: (domia: DomiaType, promptContext: string) => Promise<string>
	runStream?: (
		domia: DomiaType,
		promptContext: string,
		shouldAbort?: () => boolean,
	) => AsyncIterable<string>
	warmup?: (domia: DomiaType) => Promise<void>
	runJson?: (
		domia: DomiaType,
		promptContext: string,
		shouldAbort?: () => boolean,
	) => Promise<string>
}
