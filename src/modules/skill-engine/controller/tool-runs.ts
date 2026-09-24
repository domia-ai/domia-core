import type { SelectToolRunType } from "@/db"

import dbAdapter from "../db-adapter"
import type { ToolRunFilterType } from "../types"

export const getToolRunsSince = (
	domiaId: string,
	since: string,
	sinceId: string,
	limit: number,
): SelectToolRunType[] =>
	dbAdapter.getToolRunsSince(domiaId, since, sinceId, limit)

export const listToolRuns = (
	domiaId: string,
	filter: ToolRunFilterType,
	limit: number,
): SelectToolRunType[] => dbAdapter.listToolRuns(domiaId, filter, limit)
