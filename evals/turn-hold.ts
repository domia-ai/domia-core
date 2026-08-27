import { existsSync, readFileSync } from "fs"
import path from "path"

import * as ort from "onnxruntime-node"

import { computeWhisperLogMel } from "@/modules/turn-detector/utils/features"
import { DEFAULT_ACOUSTIC_ENDPOINT_THRESHOLD } from "@/db"

import type { PauseCorpusManifestType } from "./types"

const MODEL = "data/models/smart-turn/smart-turn-v3.2-cpu.onnx"
const MANIFEST = "evals/fixtures/stt/pauses/manifest.json"

const wavPcm = (p: string): Float32Array => {
	const buf = readFileSync(p)
	const pcm = buf.subarray(44)
	const out = new Float32Array(pcm.length / 2)
	for (let i = 0; i < out.length; i++) out[i] = pcm.readInt16LE(i * 2) / 32768
	return out
}

const main = async (): Promise<void> => {
	const manifest = JSON.parse(
		readFileSync(MANIFEST, "utf-8"),
	) as PauseCorpusManifestType
	const session = await ort.InferenceSession.create(MODEL, {
		interOpNumThreads: 1,
		intraOpNumThreads: 1,
	})
	const score = async (audio: Float32Array): Promise<number> => {
		const { data, frames } = computeWhisperLogMel(audio)
		const tensor = new ort.Tensor("float32", data, [1, 80, frames])
		const res = await session.run({ input_features: tensor })
		return (res.logits.data as Float32Array)[0]
	}
	const threshold = DEFAULT_ACOUSTIC_ENDPOINT_THRESHOLD

	let missing = 0
	let fullComplete = 0
	const byTrap = new Map<number, { held: number; n: number }>()
	for (const c of manifest.cases) {
		const cutPath = path.resolve(c.cutFile)
		const fullPath = path.resolve(c.file)
		if (!existsSync(cutPath) || !existsSync(fullPath)) {
			console.error(`❌ missing file(s) for ${c.id}`)
			missing++
			continue
		}
		const probAtPause = await score(wavPcm(cutPath))
		const probFull = await score(wavPcm(fullPath))
		if (probFull >= threshold) fullComplete++
		const held = probAtPause < threshold
		const bucket = byTrap.get(c.trapMs) ?? { held: 0, n: 0 }
		bucket.n++
		if (held) bucket.held++
		byTrap.set(c.trapMs, bucket)
		console.log(
			`  ${c.id.padEnd(14)} at-pause p=${probAtPause.toFixed(3)} ${held ? "HELD" : "released"} · full p=${probFull.toFixed(3)}`,
		)
	}

	let controlsComplete = 0
	for (const ctl of manifest.controls) {
		const p = path.resolve(ctl.file)
		if (!existsSync(p)) {
			console.error(`❌ missing control ${ctl.file}`)
			missing++
			continue
		}
		const prob = await score(wavPcm(p))
		const complete = prob >= threshold
		if (complete) controlsComplete++
		console.log(
			`  control ${ctl.id.padEnd(6)} p=${prob.toFixed(3)} ${complete ? "complete" : "INCOMPLETE?"}`,
		)
	}

	console.log(`\n=== evals:turn-hold · hold-rate per trap duration ===`)
	for (const [trapMs, b] of [...byTrap.entries()].sort((a, z) => a[0] - z[0])) {
		console.log(
			`  trap ${String(trapMs).padStart(3)}ms  held ${b.held}/${b.n}${trapMs >= 600 ? "  (known limit: VAD splits ≥600ms regardless)" : ""}`,
		)
	}
	console.log(
		`  controls complete: ${controlsComplete}/${manifest.controls.length} (threshold ${threshold})`,
	)

	console.log(
		`  full utterances complete: ${fullComplete}/${manifest.cases.length}`,
	)

	const gates: [string, boolean][] = [
		["manifest has cases", manifest.cases.length >= 12],
		["all referenced files exist", missing === 0],
		["controls mostly classified complete", controlsComplete >= 2],
		[
			"full trap utterances score complete (separation exists)",
			fullComplete >= manifest.cases.length - 2,
		],
	]
	let failed = 0
	for (const [name, ok] of gates) {
		console.log(`${ok ? "✅" : "❌"} ${name}`)
		if (!ok) failed++
	}
	process.exit(failed ? 1 : 0)
}

void main()
