import {
	SKILL_PROTOCOL_ENUM,
	type DBClientOrTxType,
	type SelectSkillProviderType,
} from "@/db"

import dbAdapter from "../db-adapter"

export const isBuiltinProvider = (
	provider: Pick<SelectSkillProviderType, "protocol">,
): boolean => provider.protocol === SKILL_PROTOCOL_ENUM.BUILTIN

export const ensureBuiltinProvider = (
	domiaId: string,
	tx?: DBClientOrTxType,
): SelectSkillProviderType => dbAdapter.ensureBuiltinProvider(domiaId, tx)
