import { readFileSync, writeFileSync, mkdirSync } from "fs"
import path from "path"
import { env, meshHeaders, waitForHealth, wer } from "./lib"

const LABEL = process.argv[2] ?? "stt-noise"
const OUT_DIR = path.resolve("evals/bench-results")
const FIXTURES = path.resolve("evals/fixtures/stt")

const corpus = JSON.parse(
	readFileSync(path.join(FIXTURES, "corpus.json"), "utf-8"),
) as { cases: { id: string; text: string }[] }
const textOf = new Map(corpus.cases.map((c) => [c.id, c.text]))

const manifest = JSON.parse(
	readFileSync(path.join(FIXTURES, "noise", "manifest.json"), "utf-8"),
) as Record<string, { cls: string; file: string }[]>

const transcribe = async (filePath: string): Promise<string | null> => {
	const res = await fetch(`${env.EVAL_URL}/voice`, {
		method: "POST",
		headers: { "content-type": "application/json", ...meshHeaders() },
		body: JSON.stringify({ filePath, speak: false }),
	})
	if (!res.ok) return null
	const json = (await res.json()) as { transcript?: string }
	return json.transcript ?? ""
}

const main = async (): Promise<void> => {
	if (!(await waitForHealth())) {
		console.error(`node not reachable at ${env.EVAL_URL}`)
		process.exit(1)
	}
	const byClass = new Map<string, { sum: number; n: number; failed: number }>()
	const rows: Record<string, unknown>[] = []
	for (const [id, entries] of Object.entries(manifest)) {
		const expected = textOf.get(id)
		if (!expected) continue
		for (const entry of entries) {
			const filePath = path.isAbsolute(entry.file)
				? entry.file
				: path.resolve(entry.file)
			const transcript = await transcribe(
				path.relative(process.cwd(), filePath),
			)
			const bucket = byClass.get(entry.cls) ?? { sum: 0, n: 0, failed: 0 }
			if (transcript === null) {
				bucket.failed++
			} else {
				const caseWer = wer(expected, transcript)
				bucket.sum += caseWer
				bucket.n++
				rows.push({
					id,
					cls: entry.cls,
					wer: Math.round(caseWer * 1000) / 1000,
					transcript,
				})
			}
			byClass.set(entry.cls, bucket)
		}
	}
	console.log(`=== evals:stt-noise · per-class WER ===`)
	let worstOk = true
	const EXPECTED_CLASSES = [
		"quiet",
		"fan",
		"music",
		"tv",
		"distance",
		"competing",
	]
	const MIN_PER_CLASS = 4
	if (Object.keys(manifest).length === 0) {
		console.error("❌ manifest is empty")
		worstOk = false
	}
	for (const id of Object.keys(manifest)) {
		if (!textOf.has(id)) {
			console.error(`❌ manifest id ${id} missing from corpus.json`)
			worstOk = false
		}
	}
	for (const cls of EXPECTED_CLASSES) {
		const b = byClass.get(cls)
		if (!b || b.n < MIN_PER_CLASS) {
			console.error(
				`❌ class ${cls} below minimum (${b?.n ?? 0}/${MIN_PER_CLASS})`,
			)
			worstOk = false
		}
	}
	for (const [cls, b] of [...byClass.entries()].sort()) {
		const mean = b.n ? b.sum / b.n : 1
		const gate = cls === "competing" ? 0.45 : 0.25
		const pass = mean <= gate && b.failed === 0
		if (!pass) worstOk = false
		console.log(
			`  ${cls.padEnd(10)} wer:${mean.toFixed(3)} (n=${b.n}, failed=${b.failed}, gate<=${gate}) ${pass ? "✅" : "❌"}`,
		)
	}
	mkdirSync(OUT_DIR, { recursive: true })
	writeFileSync(
		path.join(OUT_DIR, `${LABEL}.json`),
		JSON.stringify({ label: LABEL, rows }, null, "\t"),
	)
	console.log(`results → evals/bench-results/${LABEL}.json`)
	if (!worstOk) process.exit(1)
}

void main()
