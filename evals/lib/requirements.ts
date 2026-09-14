import { execWrite, queryOne } from "./db"
import { env } from "./env"
import { sleep } from "./http"
import type { EvalRequirementType, EvalRequirementGateType } from "../types"

export const MOCK_HA_PROVIDER_ID = "eval-mock-ha"
export const MOCK_PLAIN_PROVIDER_ID = "eval-plain-mcp"
export const MOCK_MUSIC_PROVIDER_ID = "eval-mock-music"
export const MOCK_SATELLITE_ID = "eval-mock-sat"

const SYNC_TIMEOUT_MS = 15000

const moduleFlag = (column: "skills_engine" | "fact_capture"): boolean =>
	queryOne<{ v: number }>(
		`SELECT ms.${column} AS v FROM module_settings ms JOIN domia d ON d.id = ms.domia_id WHERE d.domia_key = ? LIMIT 1`,
		[env.EVAL_DOMIA_KEY],
	)?.v === 1

const hasProviderKind = (kind: string): boolean =>
	(queryOne<{ n: number }>(
		"SELECT count(*) AS n FROM skill_provider WHERE is_active = 1 AND id NOT LIKE 'eval-%' AND descriptor LIKE ? AND domia_id = (SELECT id FROM domia WHERE domia_key = ?)",
		[`%${kind}%`, env.EVAL_DOMIA_KEY],
	)?.n ?? 0) > 0

const hasMultilingualEmbeddings = (): boolean =>
	(
		queryOne<{ v: string | null }>(
			"SELECT embed_model_path AS v FROM llm_model_config WHERE is_active = 1 LIMIT 1",
		)?.v ?? ""
	).includes("multilingual")

export const deleteMockProviders = (): void => {
	execWrite("DELETE FROM skill_provider WHERE id LIKE 'eval-%'")
	execWrite(
		"DELETE FROM satellite_config WHERE satellite_id = ? AND domia_id = (SELECT id FROM domia WHERE domia_key = ?)",
		[MOCK_SATELLITE_ID, env.EVAL_DOMIA_KEY],
	)
}

export const waitForMockSync = async (
	providerId: string,
	marker: string,
): Promise<boolean> => {
	const start = Date.now()
	while (Date.now() - start < SYNC_TIMEOUT_MS) {
		const row = queryOne<{ v: string | null }>(
			"SELECT tools_cache AS v FROM skill_provider WHERE id = ?",
			[providerId],
		)
		if (row?.v?.includes(marker)) return true
		await sleep(500)
	}
	return false
}

export const REQUIREMENT_REASON: Record<EvalRequirementType, string> = {
	skills: "module_settings.skills_engine is off",
	facts: "module_settings.fact_capture is off",
	ha: "no active non-mock home-assistant skill_provider row (a killed mock-HA run leaves the real provider deactivated)",
	music:
		"no active non-mock music-assistant skill_provider row (a killed mock run leaves the real provider deactivated)",
	multilingual:
		"llm_model_config.embed_model_path does not point at a multilingual model",
}

const reactivateProviders = (kind: string): string =>
	`sqlite3 ${env.EVAL_DB} "DELETE FROM skill_provider WHERE id LIKE 'eval-%'; UPDATE skill_provider SET is_active = 1 WHERE descriptor LIKE '%${kind}%' AND domia_id = (SELECT id FROM domia WHERE domia_key = '${env.EVAL_DOMIA_KEY}');"`

export const requirementRecovery = (
	requirement: EvalRequirementType,
): string => {
	const config = `curl -sX POST "${env.EVAL_URL}/config?domiaKey=${env.EVAL_DOMIA_KEY}" -H 'content-type: application/json'`
	const reloadSkills = `${config} -d '{"modules":{"skillsEngine":false}}' && sleep 1 && ${config} -d '{"modules":{"skillsEngine":true}}'`
	switch (requirement) {
		case "skills":
			return `${config} -d '{"modules":{"skillsEngine":true}}'`
		case "facts":
			return `${config} -d '{"modules":{"factCapture":true}}'`
		case "ha":
			return `${reactivateProviders("home-assistant")} && ${reloadSkills}`
		case "music":
			return `${reactivateProviders("music-assistant")} && ${reloadSkills}`
		case "multilingual":
			return "bash scripts/download-models.sh embeddings-multilingual, then point llm_model_config.embed_model_path at data/models/paraphrase-multilingual-minilm-l12-v2"
	}
}

export const gateRequirements = (
	requires: readonly EvalRequirementType[] | undefined,
	met: ReadonlySet<EvalRequirementType>,
): EvalRequirementGateType[] =>
	(requires ?? [])
		.filter((requirement) => !met.has(requirement))
		.map((requirement) => ({
			requirement,
			reason: REQUIREMENT_REASON[requirement],
			recovery: requirementRecovery(requirement),
		}))

export const probeRequirements = (): Set<EvalRequirementType> => {
	const met = new Set<EvalRequirementType>()
	if (moduleFlag("skills_engine")) met.add("skills")
	if (moduleFlag("fact_capture")) met.add("facts")
	if (hasProviderKind("home-assistant")) met.add("ha")
	if (hasProviderKind("music-assistant")) met.add("music")
	if (hasMultilingualEmbeddings()) met.add("multilingual")
	return met
}
