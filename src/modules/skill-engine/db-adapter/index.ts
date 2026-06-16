import { eq } from "drizzle-orm"

import {
	dbClient,
	skillProvider,
	type DBClientOrTxType,
	type SkillToolType,
} from "@/db"

const dbAdapter = {
	cacheTools: (
		serverId: string,
		tools: SkillToolType[],
		lastSyncAt: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(skillProvider)
			.set({ toolsCache: tools, lastSyncAt })
			.where(eq(skillProvider.id, serverId)),
}

export default dbAdapter
