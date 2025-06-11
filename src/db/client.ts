import { drizzle } from "drizzle-orm/better-sqlite3"
import Database from "better-sqlite3"
import path from "path"

import { env } from "@/config"
import * as schema from "./schema"

const dbPath = path.resolve(__dirname, env.DATABASE_URL)

const sqlite = new Database(dbPath)
sqlite.pragma("foreign_keys = ON")

export const dbClient = drizzle(sqlite, { schema })

export default dbClient
