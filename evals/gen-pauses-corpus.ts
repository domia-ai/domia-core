import { execSync } from "child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import os from "os"
import path from "path"

import { runTTS } from "@/modules/tts-engine"
import { getDomia } from "@/test-utils"

import type { PauseCorpusCaseType, PauseCorpusManifestType } from "./types"

const TRAP_DURATIONS_MS = [0, 300, 400, 450, 600, 800]

const CASES: { baseId: string; parts: [string, string]; text: string }[] = [
	{
		baseId: "p01",
		parts: ["Turn on the", "lights in the kitchen please."],
		text: "Turn on the lights in the kitchen please.",
	},
	{
		baseId: "p02",
		parts: ["Remind me to", "call my mom tomorrow morning."],
		text: "Remind me to call my mom tomorrow morning.",
	},
	{
		baseId: "p03",
		parts: ["Set a timer for", "twenty five minutes."],
		text: "Set a timer for twenty five minutes.",
	},
]

const OUT_DIR = path.resolve("evals/fixtures/stt/pauses")

const main = async (): Promise<void> => {
	const domia = getDomia({})
	const scratch = mkdtempSync(path.join(os.tmpdir(), "domia-pauses-"))
	mkdirSync(OUT_DIR, { recursive: true })
	const manifestCases: PauseCorpusCaseType[] = []

	for (const c of CASES) {
		const fullRes = await runTTS(domia, c.text)
		const full16 = path.join(scratch, `${c.baseId}-full.wav`)
		execSync(`sox "${fullRes.filePath}" -r 16000 -c 1 -b 16 "${full16}"`)
		const partRes = await runTTS(domia, c.parts[0])
		const part16 = path.join(scratch, `${c.baseId}-part0.wav`)
		execSync(`sox "${partRes.filePath}" -r 16000 -c 1 -b 16 "${part16}"`)
		const cutSeconds = Number(execSync(`soxi -D "${part16}"`).toString().trim())
		const head = path.join(scratch, `${c.baseId}-head.wav`)
		const tail = path.join(scratch, `${c.baseId}-tail.wav`)
		execSync(`sox "${full16}" "${head}" trim 0 ${cutSeconds}`)
		execSync(`sox "${full16}" "${tail}" trim ${cutSeconds}`)
		for (const trapMs of TRAP_DURATIONS_MS) {
			const id = `${c.baseId}-trap${String(trapMs).padStart(3, "0")}`
			const dest = path.join(OUT_DIR, `${id}.wav`)
			const cut = path.join(OUT_DIR, `${id}-cut.wav`)
			if (trapMs === 0) {
				execSync(`cp "${full16}" "${dest}"`)
				execSync(`cp "${head}" "${cut}"`)
			} else {
				const silence = path.join(scratch, `${c.baseId}-sil${trapMs}.wav`)
				execSync(
					`sox -n -r 16000 -c 1 -b 16 "${silence}" trim 0 ${trapMs / 1000}`,
				)
				execSync(`sox "${head}" "${silence}" "${tail}" "${dest}"`)
				execSync(`sox "${head}" "${silence}" "${cut}"`)
			}
			manifestCases.push({
				id,
				baseId: c.baseId,
				text: c.text,
				trapMs,
				file: `evals/fixtures/stt/pauses/${id}.wav`,
				cutFile: `evals/fixtures/stt/pauses/${id}-cut.wav`,
			})
			console.log(`${id} (trap ${trapMs}ms) :: ${c.text}`)
		}
	}

	const manifest: PauseCorpusManifestType = {
		note: "Synthetic corpus (Kokoro TTS + sox) — mid-sentence pause traps at syntactically incomplete split points. Regenerate with evals:gen-pauses.",
		cases: manifestCases,
		controls: [
			{ id: "s01", file: "evals/fixtures/stt/s01.wav" },
			{ id: "s02", file: "evals/fixtures/stt/s02.wav" },
			{ id: "s03", file: "evals/fixtures/stt/s03.wav" },
		],
	}
	writeFileSync(
		path.join(OUT_DIR, "manifest.json"),
		JSON.stringify(manifest, null, "\t"),
	)
	rmSync(scratch, { recursive: true, force: true })
	console.log(
		`manifest → evals/fixtures/stt/pauses/manifest.json (${manifestCases.length} cases)`,
	)
	process.exit(0)
}

void main()
