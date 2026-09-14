import type { McpProtocolModeType, SelectSkillProviderType } from "@/db"

import { skillProviderProtocolSchema } from "../schemas"

export const resolveProtocolMode = (
	cfg: SelectSkillProviderType,
): McpProtocolModeType =>
	skillProviderProtocolSchema.parse(cfg.config ?? {}).protocolMode

export const toolsFreshUntil = (
	refreshMs: number,
	serverTtlMs?: number,
): number | null => {
	if (refreshMs <= 0) return null
	const effective =
		serverTtlMs === undefined ? refreshMs : Math.min(refreshMs, serverTtlMs)
	return effective <= 0 ? null : Date.now() + effective
}
