import { eq, and, isNull, sql } from "drizzle-orm"

import {
	dbClient,
	domia,
	skillProvider,
	satelliteConfig,
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
	satelliteMediaPlayerName: (
		domiaId: string,
		satelliteId: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.satelliteConfig.findFirst({
			columns: { mediaPlayerName: true },
			where: and(
				eq(satelliteConfig.domiaId, domiaId),
				eq(satelliteConfig.satelliteId, satelliteId),
			),
		}),
	satelliteIdForPlayerName: (
		domiaId: string,
		name: string,
		client: DBClientOrTxType = dbClient,
	): string | null =>
		client
			.select({ satelliteId: satelliteConfig.satelliteId })
			.from(satelliteConfig)
			.where(
				and(
					eq(satelliteConfig.domiaId, domiaId),
					sql`lower(${satelliteConfig.mediaPlayerName}) = ${name.trim().toLowerCase()}`,
				),
			)
			.get()?.satelliteId ?? null,
	domiaKeyOf: (
		domiaId: string,
		client: DBClientOrTxType = dbClient,
	): string | null =>
		client
			.select({ domiaKey: domia.domiaKey })
			.from(domia)
			.where(eq(domia.id, domiaId))
			.get()?.domiaKey ?? null,
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
