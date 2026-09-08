import type { DomiaType } from "@/modules/core"

import { CONFIG_SECTION_PROPS } from "../constants"
import type {
	ConfigChangeType,
	ConfigRevertBundleType,
	ConfigRevertPlanType,
	ReloadSubsystemType,
} from "../types"

import { classifyChange } from "./classify"

const PROP_BY_SECTION = new Map(
	CONFIG_SECTION_PROPS.map(({ section, prop }) => [section, prop]),
)

const previousValue = (
	oldDomia: DomiaType,
	section: string,
	field: string,
): { found: boolean; value?: unknown } => {
	const prop = PROP_BY_SECTION.get(section)
	if (!prop || field === "*") return { found: false }
	const row = (oldDomia as unknown as Record<string, unknown>)[prop]
	if (!row || typeof row !== "object") return { found: false }
	const values = row as Record<string, unknown>
	if (!(field in values)) return { found: false }
	return { found: true, value: values[field] }
}

export const buildRevertBundle = (
	oldDomia: DomiaType,
	changes: ConfigChangeType[],
	subsystems: ReloadSubsystemType[],
): ConfigRevertPlanType => {
	const targets = new Set<string>(subsystems)
	const perSubsystem = new Map<
		ReloadSubsystemType,
		{ section: string; field: string; value: unknown }[]
	>()
	const unrevertable = new Set<ReloadSubsystemType>()
	for (const { section, field } of changes) {
		const action = classifyChange(section, field)
		if (!targets.has(action)) continue
		const subsystem = action as ReloadSubsystemType
		const previous = previousValue(oldDomia, section, field)
		if (!previous.found) {
			unrevertable.add(subsystem)
			continue
		}
		perSubsystem.set(subsystem, [
			...(perSubsystem.get(subsystem) ?? []),
			{ section, field, value: previous.value },
		])
	}
	for (const subsystem of subsystems)
		if (!perSubsystem.has(subsystem)) unrevertable.add(subsystem)
	const bundle: ConfigRevertBundleType = {}
	const revertable: ReloadSubsystemType[] = []
	for (const [subsystem, fields] of perSubsystem) {
		if (unrevertable.has(subsystem)) continue
		revertable.push(subsystem)
		for (const { section, field, value } of fields)
			bundle[section] = { ...(bundle[section] ?? {}), [field]: value }
	}
	return {
		bundle,
		subsystems: revertable,
		sections: Object.keys(bundle),
		unrevertable: [...unrevertable],
	}
}
