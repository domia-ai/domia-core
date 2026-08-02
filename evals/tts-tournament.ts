import { existsSync, mkdirSync, writeFileSync } from "fs"
import os from "os"
import path from "path"

import {
	createOfflineTts,
	writeWave,
	readWave,
	type OfflineTtsInstance,
} from "@/utils/ml-runtime"
import { getSttEngine } from "@/modules/stt-engine"
import { baseDomia } from "@/test-utils/mocks/domia"
import { baseSttConfig } from "@/test-utils/mocks/stt-config"
import { STT_ENGINE_ENUM } from "@/db"
import type { DomiaType } from "@/modules/core"

import { runtimeSnapshot, uniqueArtifactPath } from "./lib"
import type { TtsTournamentRowType, TtsTournamentCandidateType } from "./types"

const OUT_DIR = path.resolve("evals/bench-results")
const PACK_DIR = path.join(OUT_DIR, "tts-listening-pack")
const RUNS = Number(process.env.TOURNAMENT_RUNS ?? 3)
const THREADS = Number(process.env.TOURNAMENT_THREADS ?? 2)

const sttDomia = {
	...baseDomia,
	sttConfig: {
		...baseSttConfig(baseDomia.id),
		engine: STT_ENGINE_ENUM.PARAKEET,
		modelPath: "data/models/parakeet-tdt-06b-v2",
	},
} as unknown as DomiaType

const TEXT_CLASSES: { cls: string; text: string }[] = [
	{ cls: "ack", text: "Okay, the kitchen lights are on." },
	{
		cls: "normal",
		text: "The weather today is sunny with a gentle breeze. I added milk and coffee to your shopping list.",
	},
	{
		cls: "numbers_names",
		text: "Your appointment is at nine forty five with Doctor Kevin Alvarez on May third, twenty twenty six.",
	},
	{
		cls: "longform",
		text: "Here is a quick summary of your day. The morning starts cool at sixty two degrees, warming to seventy eight by mid afternoon. Traffic on the highway is light until four thirty. Your first meeting begins at ten, and the package from the bookstore should arrive before dinner. Overall it looks like a calm and productive day ahead.",
	},
]

const candidates = (): TtsTournamentCandidateType[] => {
	const list: TtsTournamentCandidateType[] = []
	const piperVariants: { label: string; dir: string; onnx: string }[] = [
		{
			label: "vits-piper-ljspeech",
			dir: "data/models/vits-piper-en_US-ljspeech-medium",
			onnx: "en_US-ljspeech-medium.onnx",
		},
		{
			label: "vits-piper-libritts_r",
			dir: "data/models/vits-piper-en_US-libritts_r-medium",
			onnx: "en_US-libritts_r-medium.onnx",
		},
		{
			label: "vits-piper-lessac",
			dir: "data/models/vits-piper-en_US-lessac-medium",
			onnx: "en_US-lessac-medium.onnx",
		},
	]
	for (const v of piperVariants) {
		const piperDir = path.resolve(v.dir)
		if (!existsSync(piperDir)) continue
		list.push({
			label: v.label,
			config: {
				model: {
					vits: {
						model: path.join(piperDir, v.onnx),
						tokens: path.join(piperDir, "tokens.txt"),
						dataDir: path.join(piperDir, "espeak-ng-data"),
					},
					debug: false,
					numThreads: THREADS,
					provider: "cpu",
				},
				maxNumSentences: 1,
			},
			generation: () => ({ sid: 0, speed: 1 }),
		})
	}
	const kokoroDir = path.resolve("data/models/kokoro-multi-lang-v1_0")
	if (existsSync(kokoroDir))
		list.push({
			label: "kokoro-v1_0",
			config: {
				model: {
					kokoro: {
						model: path.join(kokoroDir, "model.onnx"),
						voices: path.join(kokoroDir, "voices.bin"),
						tokens: path.join(kokoroDir, "tokens.txt"),
						dataDir: path.join(kokoroDir, "espeak-ng-data"),
						dictDir: path.join(kokoroDir, "dict"),
						lexicon: `${path.join(kokoroDir, "lexicon-us-en.txt")},${path.join(kokoroDir, "lexicon-zh.txt")}`,
					},
					debug: false,
					numThreads: THREADS,
					provider: "cpu",
				},
				maxNumSentences: 1,
			},
			generation: () => ({ sid: 0, speed: 1, silenceScale: 0.2 }),
		})
	const pocketDir = path.resolve(
		"data/models/sherpa-onnx-pocket-tts-int8-2026-01-26",
	)
	if (existsSync(pocketDir)) {
		const reference = readWave(path.join(pocketDir, "test_wavs/bria.wav"))
		list.push({
			label: "pocket-int8",
			config: {
				model: {
					pocket: {
						lmFlow: path.join(pocketDir, "lm_flow.int8.onnx"),
						lmMain: path.join(pocketDir, "lm_main.int8.onnx"),
						encoder: path.join(pocketDir, "encoder.onnx"),
						decoder: path.join(pocketDir, "decoder.int8.onnx"),
						textConditioner: path.join(pocketDir, "text_conditioner.onnx"),
						vocabJson: path.join(pocketDir, "vocab.json"),
						tokenScoresJson: path.join(pocketDir, "token_scores.json"),
						voiceEmbeddingCacheCapacity: 4,
					},
					debug: false,
					numThreads: THREADS,
					provider: "cpu",
				},
				maxNumSentences: 1,
			},
			generation: () => ({
				speed: 1,
				referenceAudio: reference.samples,
				referenceSampleRate: reference.sampleRate,
			}),
		})
	}
	return list
}

const tokenize = (s: string): string[] =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean)

const wer = (ref: string, hyp: string): number => {
	const a = tokenize(ref)
	const b = tokenize(hyp)
	const d: number[][] = Array.from({ length: a.length + 1 }, () =>
		new Array<number>(b.length + 1).fill(0),
	)
	for (let i = 0; i <= a.length; i++) d[i][0] = i
	for (let j = 0; j <= b.length; j++) d[0][j] = j
	for (let i = 1; i <= a.length; i++)
		for (let j = 1; j <= b.length; j++)
			d[i][j] = Math.min(
				d[i - 1][j] + 1,
				d[i][j - 1] + 1,
				d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
			)
	return a.length ? d[a.length][b.length] / a.length : 0
}

const median = (xs: number[]): number =>
	[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

const sttEngine = getSttEngine(STT_ENGINE_ENUM.PARAKEET)
if (!sttEngine) throw new Error("parakeet engine unavailable")

const main = async (): Promise<void> => {
	const list = candidates()
	if (!list.length) {
		console.log("no TTS candidates installed")
		process.exit(1)
	}
	mkdirSync(PACK_DIR, { recursive: true })
	console.log(
		`=== TTS tournament · ${os.hostname()} · runs=${RUNS} threads=${THREADS} ===`,
	)
	const rows: TtsTournamentRowType[] = []
	for (const c of list) {
		const rssBefore = process.memoryUsage().rss
		const tLoad = Date.now()
		const engine: OfflineTtsInstance = createOfflineTts(c.config)
		const loadMs = Date.now() - tLoad
		engine.generate({ text: "warm up", generationConfig: c.generation() })
		const packDir = path.join(PACK_DIR, c.label)
		mkdirSync(packDir, { recursive: true })
		for (const tc of TEXT_CLASSES) {
			const walls: number[] = []
			let audio = engine.generate({
				text: tc.text,
				generationConfig: c.generation(),
			})
			for (let r = 0; r < RUNS; r++) {
				const t0 = Date.now()
				audio = engine.generate({
					text: tc.text,
					generationConfig: c.generation(),
				})
				walls.push(Date.now() - t0)
			}
			const audioSec = audio.samples.length / audio.sampleRate
			const wavPath = path.join(packDir, `${tc.cls}.wav`)
			writeWave(wavPath, {
				sampleRate: audio.sampleRate,
				samples: audio.samples,
			})
			const heard = (await sttEngine.run(sttDomia, wavPath)) ?? ""
			const row: TtsTournamentRowType = {
				candidate: c.label,
				textClass: tc.cls,
				loadMs,
				wallMsP50: median(walls),
				wallMsMax: Math.max(...walls),
				audioSec: Number(audioSec.toFixed(2)),
				rtf: Number(
					(median(walls) / 1000 / Math.max(1e-6, audioSec)).toFixed(3),
				),
				wer: Number(wer(tc.text, heard).toFixed(3)),
				rssAfterMb: Math.round(process.memoryUsage().rss / 1048576),
			}
			rows.push(row)
			console.log(
				`  ${c.label.padEnd(12)} ${tc.cls.padEnd(14)} wall p50 ${String(row.wallMsP50).padStart(5)}ms  rtf ${row.rtf}  audio ${row.audioSec}s  wer ${row.wer}`,
			)
		}
		const rssDelta = Math.round(
			(process.memoryUsage().rss - rssBefore) / 1048576,
		)
		console.log(`  ${c.label} engine RSS delta ≈ ${rssDelta}MB\n`)
	}
	const outFile = uniqueArtifactPath(
		OUT_DIR,
		`tts-tournament-${os.hostname().split(".")[0]}`,
	)
	writeFileSync(
		outFile,
		JSON.stringify({ runtime: runtimeSnapshot(), rows }, null, "\t"),
	)
	console.log(`saved → ${outFile}\nlistening pack → ${PACK_DIR}`)
	process.exit(0)
}

void main().catch((e) => {
	console.error(e)
	process.exit(1)
})
