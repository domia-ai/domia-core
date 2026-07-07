import type { SelectSkillProviderType } from "@/db"

import type { SkillSpecializationType } from "../types"
import { homeAssistantSpecialization } from "./home-assistant"

const registry: Record<string, SkillSpecializationType> = {
	[homeAssistantSpecialization.kind]: homeAssistantSpecialization,
}

export const resolveSpecializationByKind = (
	kind: string | null | undefined,
): SkillSpecializationType | null =>
	typeof kind === "string" ? (registry[kind] ?? null) : null

export const resolveSpecialization = (
	provider: SelectSkillProviderType,
): SkillSpecializationType | null =>
	resolveSpecializationByKind(provider.descriptor?.kind)

export { homeAssistantSpecialization }
