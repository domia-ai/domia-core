import { drizzle } from "drizzle-orm/better-sqlite3"
import Database from "better-sqlite3"
import path from "path"

import { env } from "@/config"
import * as schema from "./schema"

const dbPath = path.resolve(process.cwd(), env.DATABASE_URL)

const sqlite = new Database(dbPath)

sqlite.pragma("foreign_keys = ON")

sqlite.pragma("journal_mode = WAL")
sqlite.pragma("synchronous = NORMAL")
sqlite.pragma("cache_size = -64000")
sqlite.pragma("temp_store = MEMORY")
sqlite.pragma("busy_timeout = 5000")

export const dbClient = drizzle(sqlite, { schema })

export const closeDb = (): void => {
	try {
		sqlite.close()
	} catch {
		/* */
	}
}

export default dbClient
