import { getTableColumns } from "drizzle-orm"

import { llmModelConfig as llmModelConfigTable } from "@/db/schema"
import { REASONING_EFFORT_ENUM } from "@/db"
import {
	normalizeDomia,
	normalizeLlmModelConfig,
	normalizeSttConfig,
	normalizeTtsConfig,
} from "@/modules/network-sync/utils"
import { getDomia } from "@/test-utils/factories"

import { makeChecker } from "./lib/assert"

const MIRRORED_LLM_FIELDS = [
	"reasoningEffort",
	"reflectionReasoningEffort",
	"reflectionModelName",
	"modelName",
	"engine",
]

const main = (): void => {
	const checker = makeChecker()
	console.log("\n== peer config mirror ==")

	const peer = getDomia({
		llmModelConfigOverrides: {
			reasoningEffort: REASONING_EFFORT_ENUM.HIGH,
			reflectionReasoningEffort: REASONING_EFFORT_ENUM.NONE,
		},
	})

	const mirrored = normalizeLlmModelConfig(peer)
	checker.check("a peer with an llm config mirrors it", mirrored !== null)

	checker.check(
		"reasoningEffort travels to the peer",
		mirrored?.reasoningEffort === REASONING_EFFORT_ENUM.HIGH,
		String(mirrored?.reasoningEffort),
	)
	checker.check(
		"reflectionReasoningEffort travels to the peer",
		mirrored?.reflectionReasoningEffort === REASONING_EFFORT_ENUM.NONE,
		String(mirrored?.reflectionReasoningEffort),
	)
	checker.check(
		"the mirrored effort fields are not silently defaulted",
		mirrored?.reasoningEffort !==
			peer.llmModelConfig?.reflectionReasoningEffort,
	)

	for (const field of MIRRORED_LLM_FIELDS)
		checker.check(
			`${field} is present in the mirrored subset`,
			mirrored !== null && field in mirrored,
		)

	const columns = Object.keys(getTableColumns(llmModelConfigTable))
	for (const field of Object.keys(mirrored ?? {}))
		checker.check(
			`mirrored llm field ${field} is a real llm_model_config column`,
			columns.includes(field),
		)

	checker.check(
		"the mirrored row is re-parented to the peer domia id",
		mirrored?.domiaId === peer.id,
	)

	const noLlm = getDomia({})
	noLlm.llmModelConfig = null
	checker.check(
		"a peer without an llm config mirrors nothing",
		normalizeLlmModelConfig(noLlm) === null,
	)

	checker.check(
		"the domia row still mirrors",
		normalizeDomia(peer).domiaKey === peer.domiaKey,
	)
	checker.check(
		"stt and tts configs still mirror",
		normalizeSttConfig(peer) !== null && normalizeTtsConfig(peer) !== null,
	)

	const total = checker.passCount() + checker.failCount()
	console.log(`\n${checker.passCount()}/${total} config-mirror checks passed`)
	if (checker.failCount() > 0) process.exit(1)
}

main()
