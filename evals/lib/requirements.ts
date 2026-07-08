import { queryOne } from "./db"
import type { EvalRequirementType } from "../types"

export const MOCK_HA_PROVIDER_ID = "eval-mock-ha"

const moduleFlag = (column: "skills_engine" | "fact_capture"): boolean =>
	queryOne<{ v: number }>(`SELECT ${column} AS v FROM module_settings LIMIT 1`)
		?.v === 1

const hasHaProvider = (): boolean =>
	(queryOne<{ n: number }>(
		"SELECT count(*) AS n FROM skill_provider WHERE is_active = 1 AND id != ? AND descriptor LIKE '%home-assistant%'",
		[MOCK_HA_PROVIDER_ID],
	)?.n ?? 0) > 0

const hasMultilingualEmbeddings = (): boolean =>
	(
		queryOne<{ v: string | null }>(
			"SELECT embed_model_path AS v FROM llm_model_config WHERE is_active = 1 LIMIT 1",
		)?.v ?? ""
	).includes("multilingual")

export const probeRequirements = (): Set<EvalRequirementType> => {
	const met = new Set<EvalRequirementType>()
	if (moduleFlag("skills_engine")) met.add("skills")
	if (moduleFlag("fact_capture")) met.add("facts")
	if (hasHaProvider()) met.add("ha")
	if (hasMultilingualEmbeddings()) met.add("multilingual")
	return met
}
