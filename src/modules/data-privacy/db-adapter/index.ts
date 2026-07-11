import { eq, getTableName } from "drizzle-orm"

import {
	dbClient,
	interactionTrace,
	announcement,
	memoryFact,
	memoryEpisode,
	emotionEvent,
	emotionState,
	userModel,
	knowledgeEntry,
	interactionSessionTrace,
	turnEvent,
	type DBClientOrTxType,
} from "@/db"

const USER_DATA_TABLES = [
	memoryFact,
	memoryEpisode,
	emotionEvent,
	emotionState,
	userModel,
	knowledgeEntry,
	interactionTrace,
	interactionSessionTrace,
	turnEvent,
	announcement,
] as const

const dbAdapter = {
	getTraceAudioPaths: (domiaId: string, client: DBClientOrTxType = dbClient) =>
		client
			.select({
				id: interactionTrace.id,
				inputAudioPath: interactionTrace.inputAudioPath,
				ttsAudioPath: interactionTrace.ttsAudioPath,
			})
			.from(interactionTrace)
			.where(eq(interactionTrace.domiaId, domiaId))
			.all(),
	getAnnouncementAudioPaths: (
		domiaId: string,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.select({ audioPath: announcement.audioPath })
			.from(announcement)
			.where(eq(announcement.domiaId, domiaId))
			.all(),
	deleteUserDataForDomia: (
		domiaId: string,
		client: DBClientOrTxType = dbClient,
	): Record<string, number> => {
		const deleted: Record<string, number> = {}
		for (const table of USER_DATA_TABLES) {
			const res = client.delete(table).where(eq(table.domiaId, domiaId)).run()
			deleted[getTableName(table)] = res.changes ?? 0
		}
		return deleted
	},
}

export default dbAdapter
