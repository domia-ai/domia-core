import type { DomiaType } from "@/modules/core"
import type { EmbedBackendEnumType } from "@/db"

export type EmbedTextsFnType = (
	domia: DomiaType,
	texts: string[],
) => Promise<number[][] | null>

export type EmbedCapabilitiesType = {
	local: boolean
	normalized: boolean
}

export type EmbedBackendType = {
	id: EmbedBackendEnumType
	capabilities: EmbedCapabilitiesType
	embed: EmbedTextsFnType
}
