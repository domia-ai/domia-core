import { type InsertCharacterProfileType, type DBClientOrTxType } from "@/db"

import dbAdapter from "../db-adapter"

export const updateCharacterProfileByDomiaId = (
	domiaId: string,
	data: InsertCharacterProfileType,
	client?: DBClientOrTxType,
) => dbAdapter.updateCharacterProfileByDomiaId(domiaId, data, client)
