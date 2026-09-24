import { SKILL_PROTOCOL_ENUM } from "@/db"

import { toolBaseName } from "./tool-name"
import type { DomiaType } from "@/modules/core"

import type { ToolManifestType } from "../types"
import { resolveDescriptor } from "./descriptor"

const mergeAliases = (
	into: Record<string, string[]>,
	from: Record<string, string[]>,
): void => {
	for (const [key, value] of Object.entries(from)) {
		const token = key.toLowerCase()
		into[token] = [...(into[token] ?? []), ...value.map((v) => v.toLowerCase())]
	}
}

export const buildToolManifest = (
	domia: DomiaType,
	connectedProviderIds: ReadonlySet<string>,
): ToolManifestType => {
	const aliases: Record<string, string[]> = {}
	const coreNames = new Set<string>()
	const hiddenNames = new Set<string>()
	const builtinNames = new Set<string>()
	const builtinKeywords: string[] = []
	const exampleUtterances: string[] = []
	const keywords: string[] = []
	const language = domia.characterProfile?.language ?? null
	for (const provider of domia.skillProviders ?? []) {
		if (!provider.isActive || !connectedProviderIds.has(provider.id)) continue
		const tools = provider.toolsCache ?? []
		const descriptor = resolveDescriptor(provider, language)
		mergeAliases(aliases, descriptor.aliases)
		const core = new Set(descriptor.coreTools)
		const hidden = new Set(descriptor.hiddenTools)
		const builtin = provider.protocol === SKILL_PROTOCOL_ENUM.BUILTIN
		if (builtin) builtinKeywords.push(...descriptor.keywords)
		for (const tool of tools) {
			if (builtin) builtinNames.add(tool.namespacedName)
			if (core.has(tool.rawName) || core.has(toolBaseName(tool.rawName)))
				coreNames.add(tool.namespacedName)
			if (hidden.has(tool.rawName) || hidden.has(toolBaseName(tool.rawName)))
				hiddenNames.add(tool.namespacedName)
		}
		if (builtin) continue
		exampleUtterances.push(...descriptor.exampleUtterances)
		keywords.push(...descriptor.keywords)
	}
	return {
		aliases,
		coreNames,
		hiddenNames,
		builtinNames,
		builtinKeywords,
		exampleUtterances,
		keywords,
	}
}
