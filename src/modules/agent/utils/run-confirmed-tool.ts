import { callTool, type SkillCallResultType } from "@/modules/skill-engine"

import type { PendingConfirmationType } from "../types"

export const runConfirmedTool = (
	domiaId: string,
	pending: PendingConfirmationType,
): Promise<SkillCallResultType> =>
	pending.resolvedArgs
		? callTool(domiaId, pending.tool, pending.resolvedArgs, undefined, true)
		: callTool(domiaId, pending.tool, pending.args)
