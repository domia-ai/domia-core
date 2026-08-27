import { eq, and, isNull } from "drizzle-orm"

import {
	dbClient,
	skillProvider,
	toolRun,
	TOOL_RUN_STATUS_ENUM,
	type DBClientOrTxType,
	type SkillToolType,
	type InsertToolRunType,
	type ToolRunStatusEnumType,
} from "@/db"
import { now } from "@/utils"

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
	claimToolRun: (
		row: InsertToolRunType,
		client: DBClientOrTxType = dbClient,
	): boolean =>
		client.insert(toolRun).values(row).onConflictDoNothing().run().changes > 0,
	settleToolRun: (
		id: string,
		status: ToolRunStatusEnumType,
		durationMs?: number,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(toolRun)
			.set({
				status,
				settledAt: now(),
				...(durationMs != null ? { durationMs } : {}),
			})
			.where(eq(toolRun.id, id)),
	claimSpoken: (id: string, client: DBClientOrTxType = dbClient): boolean =>
		client
			.update(toolRun)
			.set({ spokenAt: now() })
			.where(and(eq(toolRun.id, id), isNull(toolRun.spokenAt)))
			.run().changes > 0,
	unclaimSpoken: (id: string, client: DBClientOrTxType = dbClient) =>
		client.update(toolRun).set({ spokenAt: null }).where(eq(toolRun.id, id)),
	markLostDispatched: (client: DBClientOrTxType = dbClient) =>
		client
			.update(toolRun)
			.set({ status: TOOL_RUN_STATUS_ENUM.LOST, settledAt: now() })
			.where(eq(toolRun.status, TOOL_RUN_STATUS_ENUM.DISPATCHED)),
}

export default dbAdapter
