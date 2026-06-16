import { SKILL_PROTOCOL_ENUM } from "@/db"

import type { SkillAdapterType } from "../types"
import { mcpAdapter } from "./mcp"

const registry: Record<string, SkillAdapterType> = {
	[SKILL_PROTOCOL_ENUM.MCP]: mcpAdapter,
}

export const resolveSkillAdapter = (
	protocol: string,
): SkillAdapterType | null => registry[protocol] ?? null
