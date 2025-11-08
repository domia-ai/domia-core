import { eq } from "drizzle-orm"

import {
	dbClient,
	runtimeCapabilities,
	type DBClientOrTxType,
	type CapabilityEnumType,
} from "@/db"

const dbAdapter = {
	findAvailableDomiasForCapability: (
		capability: CapabilityEnumType,
		client: DBClientOrTxType = dbClient,
	) =>
		client.query.runtimeCapabilities.findMany({
			where: eq(runtimeCapabilities?.[capability], true),
			with: {
				domia: true,
			},
		}),
}

export default dbAdapter
