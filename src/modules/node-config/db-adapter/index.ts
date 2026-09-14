import { eq, sql } from "drizzle-orm"

import {
	dbClient,
	hostNode,
	DEFAULT_TIMESTAMP,
	type DBClientOrTxType,
	type InsertHostNodeType,
} from "@/db"

const dbAdapter = {
	getHostNode: (client: DBClientOrTxType = dbClient) =>
		client.query.hostNode.findFirst(),

	materializeHostNode: (
		id: string,
		fields: Partial<InsertHostNodeType>,
		tx: DBClientOrTxType,
	) =>
		tx
			.update(hostNode)
			.set({ ...fields, updatedAt: DEFAULT_TIMESTAMP })
			.where(eq(hostNode.id, id)),

	bumpNodeConfigRevision: (id: string, tx: DBClientOrTxType) =>
		tx
			.update(hostNode)
			.set({ configRevision: sql`${hostNode.configRevision} + 1` })
			.where(eq(hostNode.id, id)),
}

export default dbAdapter
