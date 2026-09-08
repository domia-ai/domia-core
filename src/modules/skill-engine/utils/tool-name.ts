import { SKILL_TOOL_NAME_SEPARATOR } from "@/db"

export const toolBaseName = (rawName: string): string => {
	const idx = rawName.lastIndexOf(SKILL_TOOL_NAME_SEPARATOR)
	return idx >= 0
		? rawName.slice(idx + SKILL_TOOL_NAME_SEPARATOR.length)
		: rawName
}

export const findToolByBaseName = <T extends { rawName: string }>(
	tools: readonly T[],
	baseName: string,
): T | undefined => tools.find((t) => toolBaseName(t.rawName) === baseName)
