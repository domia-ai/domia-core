import {
	eq,
	and,
	or,
	gt,
	gte,
	asc,
	desc,
	isNull,
	isNotNull,
	sql,
	inArray,
} from "drizzle-orm"

import {
	dbClient,
	domia,
	skillProvider,
	satelliteConfig,
	toolRun,
	routine,
	TOOL_RUN_STATUS_ENUM,
	SKILL_PROTOCOL_ENUM,
	SKILL_TRUST_TIER_ENUM,
	MCP_TRANSPORT_ENUM,
	BUILTIN_PROVIDER_ID_PREFIX,
	BUILTIN_PROVIDER_NAME,
	BUILTIN_PROVIDER_URL,
	type SelectSkillProviderType,
	type SelectRoutineType,
	type InsertRoutineType,
	type DBClientOrTxType,
	type DomiaSkillDescriptorType,
	type SkillToolType,
	type InsertToolRunType,
	type SelectToolRunType,
	type ToolRunStatusEnumType,
} from "@/db"
import { now } from "@/utils"
import type { ToolRunFilterType } from "../types"

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
	cacheServerDescriptor: (
		serverId: string,
		descriptor: DomiaSkillDescriptorType | null,
		hash: string | null,
		syncedAt: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(skillProvider)
			.set({
				serverDescriptor: descriptor,
				serverDescriptorHash: hash,
				lastSyncAt: syncedAt,
				updatedAt: syncedAt,
			})
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
	satelliteMediaPlayerNames: (
		domiaId: string,
		client: DBClientOrTxType = dbClient,
	): string[] =>
		client
			.select({ name: satelliteConfig.mediaPlayerName })
			.from(satelliteConfig)
			.where(
				and(
					eq(satelliteConfig.domiaId, domiaId),
					isNotNull(satelliteConfig.mediaPlayerName),
				),
			)
			.all()
			.flatMap((r) => (r.name ? [r.name] : [])),
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
	getToolRunsSince: (
		domiaId: string,
		since: string,
		sinceId: string,
		limit: number,
		client: DBClientOrTxType = dbClient,
	): SelectToolRunType[] =>
		client
			.select()
			.from(toolRun)
			.where(
				and(
					eq(toolRun.domiaId, domiaId),
					sinceId
						? or(
								gt(toolRun.createdAt, since),
								and(eq(toolRun.createdAt, since), gt(toolRun.id, sinceId)),
							)
						: gte(toolRun.createdAt, since),
				),
			)
			.orderBy(asc(toolRun.createdAt), asc(toolRun.id))
			.limit(limit)
			.all(),
	listToolRuns: (
		domiaId: string,
		filter: ToolRunFilterType,
		limit: number,
		client: DBClientOrTxType = dbClient,
	): SelectToolRunType[] =>
		client
			.select()
			.from(toolRun)
			.where(
				and(
					eq(toolRun.domiaId, domiaId),
					filter.interactionId
						? eq(toolRun.interactionId, filter.interactionId)
						: undefined,
					filter.tool ? eq(toolRun.tool, filter.tool) : undefined,
					filter.statuses?.length
						? inArray(toolRun.status, filter.statuses)
						: undefined,
					filter.since ? gte(toolRun.createdAt, filter.since) : undefined,
				),
			)
			.orderBy(desc(toolRun.createdAt), desc(toolRun.id))
			.limit(limit)
			.all(),
	markLostDispatched: (client: DBClientOrTxType = dbClient) =>
		client
			.update(toolRun)
			.set({ status: TOOL_RUN_STATUS_ENUM.LOST, settledAt: now() })
			.where(eq(toolRun.status, TOOL_RUN_STATUS_ENUM.DISPATCHED)),
	ensureBuiltinProvider: (
		domiaId: string,
		client: DBClientOrTxType = dbClient,
	): SelectSkillProviderType => {
		const canonicalId = `${BUILTIN_PROVIDER_ID_PREFIX}${domiaId}`
		const protectedFields = {
			name: BUILTIN_PROVIDER_NAME,
			isActive: true,
			protocol: SKILL_PROTOCOL_ENUM.BUILTIN,
			type: MCP_TRANSPORT_ENUM.HTTP,
			url: BUILTIN_PROVIDER_URL,
			trustTier: SKILL_TRUST_TIER_ENUM.TRUSTED,
		}
		const builtinRows = (): SelectSkillProviderType[] =>
			client
				.select()
				.from(skillProvider)
				.where(
					and(
						eq(skillProvider.domiaId, domiaId),
						eq(skillProvider.protocol, SKILL_PROTOCOL_ENUM.BUILTIN),
					),
				)
				.all()
		let rows = builtinRows()
		if (rows.length === 0) {
			const inserted = client
				.insert(skillProvider)
				.values({
					id: canonicalId,
					domiaId,
					...protectedFields,
					descriptor: { version: 1, kind: BUILTIN_PROVIDER_NAME },
				})
				.onConflictDoNothing()
				.returning()
				.get() as SelectSkillProviderType | undefined
			if (inserted) return inserted
			rows = builtinRows()
		}
		const keep = rows.find((r) => r.id === canonicalId) ?? rows[0]
		const duplicates = rows.filter((r) => r.id !== keep.id).map((r) => r.id)
		if (duplicates.length > 0)
			client
				.delete(skillProvider)
				.where(inArray(skillProvider.id, duplicates))
				.run()
		const kindIntact = keep.descriptor?.kind === BUILTIN_PROVIDER_NAME
		const fieldsIntact = Object.entries(protectedFields).every(
			([key, value]) => keep[key as keyof typeof protectedFields] === value,
		)
		if (kindIntact && fieldsIntact) return keep
		return client
			.update(skillProvider)
			.set({
				...protectedFields,
				...(kindIntact
					? {}
					: {
							descriptor: {
								...keep.descriptor,
								version: 1,
								kind: BUILTIN_PROVIDER_NAME,
							},
						}),
				updatedAt: now(),
			})
			.where(eq(skillProvider.id, keep.id))
			.returning()
			.get()
	},
	listRoutines: (
		domiaId: string,
		client: DBClientOrTxType = dbClient,
	): SelectRoutineType[] =>
		client
			.select()
			.from(routine)
			.where(eq(routine.domiaId, domiaId))
			.orderBy(routine.slug)
			.all(),
	getRoutine: (
		domiaId: string,
		id: string,
		client: DBClientOrTxType = dbClient,
	): SelectRoutineType | null =>
		client
			.select()
			.from(routine)
			.where(and(eq(routine.domiaId, domiaId), eq(routine.id, id)))
			.get() ?? null,
	getRoutineBySlug: (
		domiaId: string,
		slug: string,
		client: DBClientOrTxType = dbClient,
	): SelectRoutineType | null =>
		client
			.select()
			.from(routine)
			.where(and(eq(routine.domiaId, domiaId), eq(routine.slug, slug)))
			.get() ?? null,
	insertRoutine: (
		row: InsertRoutineType,
		client: DBClientOrTxType = dbClient,
	): SelectRoutineType => client.insert(routine).values(row).returning().get(),
	updateRoutine: (
		domiaId: string,
		id: string,
		patch: Partial<Omit<InsertRoutineType, "id" | "domiaId">>,
		client: DBClientOrTxType = dbClient,
	): SelectRoutineType =>
		client
			.update(routine)
			.set({ ...patch, updatedAt: now() })
			.where(and(eq(routine.domiaId, domiaId), eq(routine.id, id)))
			.returning()
			.get(),
	deleteRoutine: (
		domiaId: string,
		id: string,
		client: DBClientOrTxType = dbClient,
	): boolean =>
		client
			.delete(routine)
			.where(and(eq(routine.domiaId, domiaId), eq(routine.id, id)))
			.run().changes > 0,
}

export default dbAdapter
