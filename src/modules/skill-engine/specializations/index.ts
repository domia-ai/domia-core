import type { SelectSkillProviderType } from "@/db"
import { registerCatalogExtension } from "@/utils"

import type { SkillSpecializationType } from "../types"
import { domiaSpecialization } from "./domia"
import { homeAssistantSpecialization } from "./home-assistant"
import { musicAssistantSpecialization } from "./music-assistant"

const registry: Record<string, SkillSpecializationType> = {
	[homeAssistantSpecialization.kind]: homeAssistantSpecialization,
	[musicAssistantSpecialization.kind]: musicAssistantSpecialization,
	[domiaSpecialization.kind]: domiaSpecialization,
}

export const registerSpecialization = (
	specialization: SkillSpecializationType,
): void => {
	registry[specialization.kind] = specialization
	if (specialization.catalogExtensions)
		registerCatalogExtension(
			specialization.kind,
			specialization.catalogExtensions,
		)
}

for (const specialization of Object.values(registry))
	if (specialization.catalogExtensions)
		registerCatalogExtension(
			specialization.kind,
			specialization.catalogExtensions,
		)

export const listSpecializations = (): SkillSpecializationType[] =>
	Object.values(registry)

export const resolveSpecializationByKind = (
	kind: string | null | undefined,
): SkillSpecializationType | null =>
	typeof kind === "string" ? (registry[kind] ?? null) : null

export const resolveSpecialization = (
	provider: SelectSkillProviderType,
): SkillSpecializationType | null =>
	resolveSpecializationByKind(provider.descriptor?.kind)

export {
	homeAssistantSpecialization,
	musicAssistantSpecialization,
	domiaSpecialization,
}
export {
	routinesOf,
	activeRoutinesOf,
	invalidateRoutines,
	saveRoutine,
	removeRoutine,
	routineToolName,
	routinePolicyOf,
} from "./domia/routines"
