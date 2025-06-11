import { eq } from "drizzle-orm"

import {
	dbClient,
	characterProfile,
	type DBClientOrTxType,
	type InsertCharacterProfileType,
	type UpdateCharacterProfileType,
	DEFAULT_TIMESTAMP,
} from "@/db"

const dbAdapter = {
	insertCharacterProfile: (
		data: InsertCharacterProfileType,
		client: DBClientOrTxType = dbClient,
	) => client.insert(characterProfile).values(data),
	upsertCharacterProfile: (
		data: InsertCharacterProfileType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.insert(characterProfile)
			.values({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.onConflictDoUpdate({
				target: characterProfile.id,
				set: data,
			}),
	updateCharacterProfileByDomiaId: (
		domiaId: string,
		data: UpdateCharacterProfileType,
		client: DBClientOrTxType = dbClient,
	) =>
		client
			.update(characterProfile)
			.set({ ...data, updatedAt: DEFAULT_TIMESTAMP })
			.where(eq(characterProfile.domiaId, domiaId)),
}

export default dbAdapter
