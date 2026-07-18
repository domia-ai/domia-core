import { readFileSync, writeFileSync, mkdirSync } from "fs"
import path from "path"
import { env, meshHeaders, waitForHealth, wer } from "./lib"

const LABEL = process.argv[2] ?? "stt-wer"
const OUT_DIR = path.resolve("evals/bench-results")
const FIXTURES = path.resolve("evals/fixtures/stt")

const corpus = JSON.parse(
	readFileSync(path.join(FIXTURES, "corpus.json"), "utf-8"),
) as { cases: { id: string; text: string }[] }

const main = async (): Promise<void> => {
	if (!(await waitForHealth())) {
		console.error(`node not reachable at ${env.EVAL_URL}`)
		process.exit(1)
	}
	console.log(
		`=== evals:stt · label="${LABEL}" · ${env.EVAL_URL} · cases=${corpus.cases.length} ===`,
	)
	const rows: Record<string, unknown>[] = []
	let failed = 0
	for (const c of corpus.cases) {
		// repo-relative so the node resolves it against its own checkout (works against remote nodes)
		const filePath = path.join("evals/fixtures/stt", `${c.id}.wav`)
		const res = await fetch(`${env.EVAL_URL}/voice`, {
			method: "POST",
			headers: { "content-type": "application/json", ...meshHeaders() },
			body: JSON.stringify({ filePath, speak: false }),
		})
		if (!res.ok) {
			failed++
			rows.push({ id: c.id, status: `http_${res.status}` })
			console.log(`  ${c.id}  FAILED (${res.status})`)
			continue
		}
		const json = (await res.json()) as { transcript?: string }
		const transcript = json.transcript ?? ""
		const caseWer = wer(c.text, transcript)
		rows.push({
			id: c.id,
			expected: c.text,
			transcript,
			wer: Math.round(caseWer * 1000) / 1000,
			status: "ok",
		})
		console.log(
			`  ${c.id}  wer:${caseWer.toFixed(3)}  "${transcript.slice(0, 60)}"`,
		)
	}
	const ok = rows.filter((r) => r.status === "ok")
	const meanWer = ok.length
		? ok.reduce((s, r) => s + Number(r.wer), 0) / ok.length
		: 1
	console.log(
		`\nmean WER: ${(meanWer * 100).toFixed(1)}%  (${ok.length}/${corpus.cases.length} ok)`,
	)
	mkdirSync(OUT_DIR, { recursive: true })
	const outFile = path.join(OUT_DIR, `${LABEL}.json`)
	writeFileSync(
		outFile,
		JSON.stringify(
			{
				label: LABEL,
				at: new Date().toISOString(),
				meanWer: Math.round(meanWer * 1000) / 1000,
				rows,
			},
			null,
			"\t",
		),
	)
	console.log(`results → ${outFile}`)
	process.exit(failed > 0 ? 1 : 0)
}

void main()
