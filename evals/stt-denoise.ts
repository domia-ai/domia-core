import { readFileSync, existsSync } from "fs"
import path from "path"

import {
	DEFAULT_PCM_SAMPLE_RATE,
	DEFAULT_DENOISE_MODEL_PATH,
	DEFAULT_GTCRN_MODEL_PATH,
	DEFAULT_DENOISE_NUM_THREADS,
	DEFAULT_DENOISE_PROVIDER,
	DEFAULT_STT_MODEL_PATH,
	DEFAULT_STT_MODEL_NAME,
	DEFAULT_STT_NUM_THREADS,
	DEFAULT_STT_PROVIDER,
	DEFAULT_STT_DECODE_PADDING_MS,
	DEFAULT_STT_FLUSH_PADDING_MS,
	DEFAULT_STT_ENABLE_ENDPOINT,
	DEFAULT_STT_RULE1_MIN_TRAILING_SILENCE,
	DEFAULT_STT_RULE2_MIN_TRAILING_SILENCE,
	DEFAULT_STT_RULE3_MIN_UTTERANCE_LENGTH,
	DEFAULT_LANGUAGE,
	DEFAULT_QUANTIZATION,
	SPEECH_ENHANCER_ENGINE_ENUM,
	DEFAULT_DENOISE_ENGINE,
	STT_ENGINE_ENUM,
} from "@/db/constants"
import type { SpeechEnhancerEngineEnumType } from "@/db"
import { createCaptureEnhancer } from "@/modules/speech-enhancer"
import { transcribeSttJob } from "@/modules/stt-engine/utils/inference"
import type { SttWorkerEngineConfigType } from "@/modules/stt-engine/types"

import { makeChecker, parseWavPcm, wer } from "./lib"
import type { SttDenoiseCorpusType, SttDenoiseManifestType } from "./types"

const FIXTURES = path.resolve("evals/fixtures/stt")
const TOLERANCE = 0.02
const CHUNK_MS = 100

const MODEL_PATHS: Record<SpeechEnhancerEngineEnumType, string> = {
	[SPEECH_ENHANCER_ENGINE_ENUM.GTCRN]: DEFAULT_GTCRN_MODEL_PATH,
	[SPEECH_ENHANCER_ENGINE_ENUM.DPDFNET]: DEFAULT_DENOISE_MODEL_PATH,
}

const sttConfig: SttWorkerEngineConfigType = {
	engine: STT_ENGINE_ENUM.PARAKEET,
	modelPath: DEFAULT_STT_MODEL_PATH,
	modelName: DEFAULT_STT_MODEL_NAME,
	language: DEFAULT_LANGUAGE,
	quantization: DEFAULT_QUANTIZATION,
	numThreads: DEFAULT_STT_NUM_THREADS,
	provider: DEFAULT_STT_PROVIDER,
	decodePaddingMs: DEFAULT_STT_DECODE_PADDING_MS,
	flushPaddingMs: DEFAULT_STT_FLUSH_PADDING_MS,
	enableEndpoint: DEFAULT_STT_ENABLE_ENDPOINT,
	rule1MinTrailingSilence: DEFAULT_STT_RULE1_MIN_TRAILING_SILENCE,
	rule2MinTrailingSilence: DEFAULT_STT_RULE2_MIN_TRAILING_SILENCE,
	rule3MinUtteranceLength: DEFAULT_STT_RULE3_MIN_UTTERANCE_LENGTH,
}

const corpus = JSON.parse(
	readFileSync(path.join(FIXTURES, "corpus.json"), "utf-8"),
) as SttDenoiseCorpusType
const textOf = new Map(corpus.cases.map((c) => [c.id, c.text]))

const manifest = JSON.parse(
	readFileSync(path.join(FIXTURES, "noise", "manifest.json"), "utf-8"),
) as SttDenoiseManifestType

const transcribe = (pcm: Buffer): string =>
	transcribeSttJob({
		kind: "pcm",
		engineConfig: sttConfig,
		pcm,
		sampleRate: DEFAULT_PCM_SAMPLE_RATE,
	}).text

const denoise = (pcm: Buffer, engine: SpeechEnhancerEngineEnumType): Buffer => {
	const stage = createCaptureEnhancer(
		{
			denoiseEnabled: true,
			denoiseEngine: engine,
			denoiseModelPath: MODEL_PATHS[engine],
			denoiseNumThreads: DEFAULT_DENOISE_NUM_THREADS,
			denoiseProvider: DEFAULT_DENOISE_PROVIDER,
			sampleRate: DEFAULT_PCM_SAMPLE_RATE,
			channels: 1,
		},
		"stt-denoise",
	)
	if (!stage.active) return pcm
	const chunk = Math.round((DEFAULT_PCM_SAMPLE_RATE * CHUNK_MS) / 1000) * 2
	const parts: Buffer[] = []
	for (let off = 0; off < pcm.length; off += chunk)
		parts.push(
			stage.process(pcm.subarray(off, Math.min(off + chunk, pcm.length))),
		)
	parts.push(stage.flush())
	stage.close()
	return Buffer.concat(parts)
}

const meanOf = (values: number[]): number =>
	values.length === 0 ? 1 : values.reduce((s, v) => s + v, 0) / values.length

const runEngine = (
	engine: SpeechEnhancerEngineEnumType,
	c: ReturnType<typeof makeChecker>,
): void => {
	console.log(`\nspeech enhancement WER (${engine})`)
	if (!existsSync(path.resolve(MODEL_PATHS[engine]))) {
		console.log(
			`  ⏭️ SKIPPED — model missing at ${MODEL_PATHS[engine]} (run: npm run setup:models:${engine.toLowerCase()})`,
		)
		return
	}
	const rawByClass = new Map<string, number[]>()
	const cleanByClass = new Map<string, number[]>()
	for (const [id, entries] of Object.entries(manifest)) {
		const expected = textOf.get(id)
		if (!expected) continue
		for (const entry of entries) {
			const wavPath = path.resolve(entry.file)
			if (!existsSync(wavPath)) continue
			const { pcm } = parseWavPcm(wavPath)
			const rawWer = wer(expected, transcribe(pcm))
			const cleanWer = wer(expected, transcribe(denoise(pcm, engine)))
			rawByClass.set(entry.cls, [...(rawByClass.get(entry.cls) ?? []), rawWer])
			cleanByClass.set(entry.cls, [
				...(cleanByClass.get(entry.cls) ?? []),
				cleanWer,
			])
		}
	}
	const classes = [...rawByClass.keys()]
	for (const cls of classes) {
		const raw = meanOf(rawByClass.get(cls) ?? [])
		const clean = meanOf(cleanByClass.get(cls) ?? [])
		console.log(
			`  ${cls.padEnd(10)} raw ${(raw * 100).toFixed(1)}%  denoised ${(clean * 100).toFixed(1)}%  Δ ${((clean - raw) * 100).toFixed(1)}pt`,
		)
	}
	const rawAll = meanOf(classes.flatMap((cls) => rawByClass.get(cls) ?? []))
	const cleanAll = meanOf(classes.flatMap((cls) => cleanByClass.get(cls) ?? []))
	console.log(
		`  ${"overall".padEnd(10)} raw ${(rawAll * 100).toFixed(1)}%  denoised ${(cleanAll * 100).toFixed(1)}%  Δ ${((cleanAll - rawAll) * 100).toFixed(1)}pt`,
	)
	if (engine !== DEFAULT_DENOISE_ENGINE) return
	c.check(
		`default engine ${engine} does not degrade WER beyond ${(TOLERANCE * 100).toFixed(0)}pt`,
		cleanAll <= rawAll + TOLERANCE,
		`raw=${rawAll.toFixed(3)} denoised=${cleanAll.toFixed(3)}`,
	)
}

const main = (): void => {
	console.log("=== evals:stt-denoise ===")
	const c = makeChecker()
	for (const engine of Object.values(SPEECH_ENHANCER_ENGINE_ENUM))
		runEngine(engine, c)
	console.log(`\n${c.passCount()} passed, ${c.failCount()} failed`)
	process.exit(c.failCount() === 0 ? 0 : 1)
}

main()
