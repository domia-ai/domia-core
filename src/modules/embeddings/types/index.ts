import type { DomiaType } from "@/modules/core"
import type { EmbedBackendEnumType } from "@/db"

export type EmbedTextsFnType = (
	domia: DomiaType,
	texts: string[],
) => Promise<number[][] | null>

export type EmbedBackendType = {
	id: EmbedBackendEnumType
	embed: EmbedTextsFnType
}
