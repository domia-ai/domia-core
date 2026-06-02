import { and, eq } from "drizzle-orm"

import {
	dbClient,
	characterProfile,
	moduleSettings,
	emotionState,
	type DBClientOrTxType,
	DEFAULT_TIMESTAMP,
} from "@/db"
import type { MindSnapshotType } from "../types"

const dbAdapter = {
	materializeCharacter: (
		domiaId: string,
		character: MindSnapshotType["character"],
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(characterProfile)
			.set({ ...character, updatedAt: DEFAULT_TIMESTAMP })
			.where(
				and(
					eq(characterProfile.domiaId, domiaId),
					eq(characterProfile.isActive, true),
				),
			),

	materializeModules: (
		domiaId: string,
		modules: MindSnapshotType["modules"],
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(moduleSettings)
			.set({ ...modules, updatedAt: DEFAULT_TIMESTAMP })
			.where(
				and(
					eq(moduleSettings.domiaId, domiaId),
					eq(moduleSettings.isActive, true),
				),
			),

	materializeEmotion: (
		domiaId: string,
		emotionBaseline: MindSnapshotType["emotionBaseline"],
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(emotionState)
			.set({ ...emotionBaseline, updatedAt: DEFAULT_TIMESTAMP })
			.where(eq(emotionState.domiaId, domiaId)),
}

export default dbAdapter
