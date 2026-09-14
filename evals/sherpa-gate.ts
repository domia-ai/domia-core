import { existsSync } from "fs"
import path from "path"

import { DEFAULT_WAKE_WORD_MODEL_PATH } from "@/db/constants"
import {
	createKeywordSpotter,
	readWave,
	runtimeVersions,
} from "@/utils/ml-runtime"

import { makeChecker } from "./lib"

const MODEL_DIR = path.resolve(DEFAULT_WAKE_WORD_MODEL_PATH)
const STEM = "epoch-12-avg-2-chunk-16-left-64"
const TAIL_SECONDS = 0.5

const EXPECTED: Record<string, string[]> = {
	"0.wav": ["LIGHTUP"],
	"1.wav": ["LOVELYCHILD", "FOREVER"],
}

const squash = (s: string): string => s.replace(/\s+/g, "")

const main = (): void => {
	const versions = runtimeVersions()
	console.log(
		`=== evals:sherpa-gate · sherpa ${versions.sherpa} · onnxruntime ${versions.onnxruntime} ===`,
	)
	const c = makeChecker()
	const keywordsFile = path.join(MODEL_DIR, "test_wavs", "test_keywords.txt")
	if (!existsSync(keywordsFile)) {
		console.log(
			`  ⏭️ SKIPPED — canonical KWS fixtures missing at ${MODEL_DIR} (run: bash scripts/download-models.sh kws)`,
		)
		process.exit(0)
	}
	const spotter = createKeywordSpotter({
		featConfig: { sampleRate: 16000, featureDim: 80 },
		modelConfig: {
			transducer: {
				encoder: path.join(MODEL_DIR, `encoder-${STEM}.onnx`),
				decoder: path.join(MODEL_DIR, `decoder-${STEM}.onnx`),
				joiner: path.join(MODEL_DIR, `joiner-${STEM}.onnx`),
			},
			tokens: path.join(MODEL_DIR, "tokens.txt"),
			numThreads: 2,
			provider: "cpu",
			debug: 0,
		},
		keywordsFile,
	})
	for (const [wav, expected] of Object.entries(EXPECTED)) {
		const wave = readWave(path.join(MODEL_DIR, "test_wavs", wav))
		const stream = spotter.createStream()
		stream.acceptWaveform({
			sampleRate: wave.sampleRate,
			samples: wave.samples,
		})
		stream.acceptWaveform({
			sampleRate: wave.sampleRate,
			samples: new Float32Array(Math.round(wave.sampleRate * TAIL_SECONDS)),
		})
		const hits: string[] = []
		while (spotter.isReady(stream)) {
			spotter.decode(stream)
			const keyword = spotter.getResult(stream).keyword
			if (keyword) hits.push(squash(keyword))
		}
		c.check(
			`${wav} spots ${expected.join(" + ")}`,
			expected.every((k) => hits.includes(k)),
			`got=${hits.join(",") || "none"}`,
		)
	}
	console.log(`\n${c.passCount()} passed, ${c.failCount()} failed`)
	process.exit(c.failCount() === 0 ? 0 : 1)
}

main()
