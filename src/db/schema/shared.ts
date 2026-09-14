import { sql } from "drizzle-orm"

export const DEFAULT_TIMESTAMP = sql`CURRENT_TIMESTAMP`

export const MS_TIMESTAMP = sql`(strftime('%Y-%m-%d %H:%M:%f','now'))`
