import { writeFileSync } from "fs"
import path from "path"

import { queryAll } from "./lib"
import type { PromotionCandidateType } from "./types"

const OUT = path.resolve("evals/candidates/promoted-traces.json")

const main = (): void => {
	const rows = queryAll<{
		id: string
		stt_result: string | null
		input_raw: string | null
		llm_prompt: string | null
		implicit_feedback: string | null
		status: string
		created_at: string
	}>(
		`SELECT id, stt_result, input_raw, llm_prompt, implicit_feedback, status, created_at
		 FROM interaction_trace
		 WHERE implicit_feedback IN ('barge_in','rephrase')
		    OR status IN ('failed','aborted')
		 ORDER BY created_at DESC
		 LIMIT 200`,
	)

	const candidates: PromotionCandidateType[] = rows
		.map((r) => ({
			interactionId: r.id,
			utterance: (r.stt_result ?? r.input_raw ?? "").trim(),
			signal: r.implicit_feedback ?? r.status,
			at: r.created_at,
		}))
		.filter((c) => c.utterance.length > 0)

	writeFileSync(
		OUT,
		JSON.stringify(
			{
				generatedFrom: "interaction_trace",
				count: candidates.length,
				candidates,
			},
			null,
			2,
		),
	)
	console.log(
		`promoted ${candidates.length} low-quality traces → ${path.relative(process.cwd(), OUT)}`,
	)
	const bySignal = candidates.reduce<Record<string, number>>((acc, c) => {
		acc[c.signal] = (acc[c.signal] ?? 0) + 1
		return acc
	}, {})
	console.log("by signal:", JSON.stringify(bySignal))
}

main()
