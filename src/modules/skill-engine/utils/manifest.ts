import type { DomiaType } from "@/modules/core"

import type { ToolManifestType } from "../types"
import { resolveDescriptor } from "./descriptor"

const mergeAliases = (
	into: Record<string, string[]>,
	from: Record<string, string[]>,
): void => {
	for (const [key, value] of Object.entries(from)) {
		const token = key.toLowerCase()
		into[token] = [
			...(into[token] ?? []),
			...value.map((v) => String(v).toLowerCase()),
		]
	}
}

export const buildToolManifest = (domia: DomiaType): ToolManifestType => {
	const aliases: Record<string, string[]> = {}
	const coreNames = new Set<string>()
	const exampleUtterances: string[] = []
	const keywords: string[] = []
	const language = domia.characterProfile?.language ?? null
	for (const provider of domia.skillProviders ?? []) {
		if (!provider.isActive) continue
		const tools = provider.toolsCache ?? []
		const descriptor = resolveDescriptor(provider, language)
		mergeAliases(aliases, descriptor.aliases)
		const core = new Set(descriptor.coreTools)
		for (const tool of tools)
			if (core.has(tool.rawName)) coreNames.add(tool.namespacedName)
		exampleUtterances.push(...descriptor.exampleUtterances)
		keywords.push(...descriptor.keywords)
	}
	return { aliases, coreNames, exampleUtterances, keywords }
}
