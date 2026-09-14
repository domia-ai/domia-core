import { SKILL_TOOL_NAME_SEPARATOR } from "@/db"
import { toolBaseName } from "@/modules/skill-engine"
import type { ToolDefinitionType } from "@/modules/llm-engine"

import type { ToolAliasMapType } from "../types"

const providerPrefixOf = (namespacedName: string): string => {
	const idx = namespacedName.indexOf(SKILL_TOOL_NAME_SEPARATOR)
	return idx > 0 ? namespacedName.slice(0, idx) : ""
}

const candidatesFor = (namespacedName: string): string[] => {
	const base = toolBaseName(namespacedName)
	const prefix = providerPrefixOf(namespacedName)
	const scoped = prefix
		? `${prefix}${SKILL_TOOL_NAME_SEPARATOR}${base}`
		: namespacedName
	return [...new Set([base, scoped, namespacedName])]
}

export const createToolAliasMap = (
	toolDefs: ToolDefinitionType[],
): ToolAliasMapType => {
	const uses = new Map<string, number>()
	for (const def of toolDefs)
		for (const candidate of candidatesFor(def.name))
			uses.set(candidate, (uses.get(candidate) ?? 0) + 1)
	const aliasByName = new Map<string, string>()
	const nameByAlias = new Map<string, string>()
	for (const def of toolDefs) {
		const alias =
			candidatesFor(def.name).find((c) => uses.get(c) === 1) ?? def.name
		aliasByName.set(def.name, alias)
		nameByAlias.set(alias, def.name)
		nameByAlias.set(def.name, def.name)
	}
	const aliasOf = (namespacedName: string): string =>
		aliasByName.get(namespacedName) ?? namespacedName
	return {
		toolDefs: toolDefs.map((def) => ({ ...def, name: aliasOf(def.name) })),
		aliases: toolDefs.map((def) => aliasOf(def.name)),
		aliasOf,
		namespacedOf: (advertisedName) => nameByAlias.get(advertisedName),
	}
}
