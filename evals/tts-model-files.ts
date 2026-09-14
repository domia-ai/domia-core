import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { basename, join } from "path"

import { TTS_ERRORS, isDomiaError } from "@/utils"
import { resolveSupertonicPaths } from "@/modules/tts-engine/engines/supertonic/inference"

import { makeChecker } from "./lib/assert"
import type { CheckerType } from "./types"

const STEMS = [
	"duration_predictor",
	"text_encoder",
	"vector_estimator",
	"vocoder",
]

const makeBundle = (files: string[]): string => {
	const dir = mkdtempSync(join(tmpdir(), "domia-supertonic-"))
	for (const file of files) writeFileSync(join(dir, file), "")
	writeFileSync(join(dir, "tts.json"), "{}")
	writeFileSync(join(dir, "unicode_indexer.bin"), "")
	writeFileSync(join(dir, "voice.bin"), "")
	return dir
}

const onnxNames = (suffix: string): string[] =>
	STEMS.map((stem) => `${stem}${suffix}.onnx`)

const voiceNotFound = (run: () => unknown): boolean => {
	try {
		run()
		return false
	} catch (err) {
		return isDomiaError(err) && err.code === TTS_ERRORS.VOICE_NOT_FOUND.code
	}
}

const withBundle = (files: string[], run: (dir: string) => void): void => {
	const dir = makeBundle(files)
	try {
		run(dir)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

const int8Checks = (checker: CheckerType): void => {
	withBundle(onnxNames(".int8"), (dir) => {
		const paths = resolveSupertonicPaths(dir, "int8")
		checker.check(
			"int8 bundle: every onnx resolves to the .int8 file",
			STEMS.every(
				(stem, i) =>
					basename(
						[
							paths.durationPredictor,
							paths.textEncoder,
							paths.vectorEstimator,
							paths.vocoder,
						][i],
					) === `${stem}.int8.onnx`,
			),
			basename(paths.vocoder),
		)
		checker.check(
			"int8 bundle: the non-onnx assets keep their fixed names",
			basename(paths.ttsJson) === "tts.json" &&
				basename(paths.unicodeIndexer) === "unicode_indexer.bin" &&
				basename(paths.voiceStyle) === "voice.bin",
		)
	})
}

const fp32Checks = (checker: CheckerType): void => {
	withBundle(onnxNames(""), (dir) => {
		const paths = resolveSupertonicPaths(dir, "int8")
		checker.check(
			"fp32-only bundle: int8 preference falls back to the plain names",
			basename(paths.vocoder) === "vocoder.onnx" &&
				basename(paths.textEncoder) === "text_encoder.onnx",
			basename(paths.vocoder),
		)
	})
	withBundle([...onnxNames(""), ...onnxNames(".int8")], (dir) => {
		checker.check(
			"mixed bundle: quantization=int8 picks the int8 files",
			basename(resolveSupertonicPaths(dir, "int8").vocoder) ===
				"vocoder.int8.onnx",
		)
		checker.check(
			"mixed bundle: quantization=fp32 picks the plain files",
			basename(resolveSupertonicPaths(dir, "fp32").vocoder) === "vocoder.onnx",
		)
	})
}

const missingChecks = (checker: CheckerType): void => {
	withBundle([], (dir) => {
		checker.check(
			"no onnx at all throws TTS/VOICE_NOT_FOUND",
			voiceNotFound(() => resolveSupertonicPaths(dir, "int8")),
		)
	})
	withBundle(["vocoder.int8.onnx"], (dir) => {
		checker.check(
			"a partial bundle throws TTS/VOICE_NOT_FOUND",
			voiceNotFound(() => resolveSupertonicPaths(dir, "int8")),
		)
	})
	checker.check(
		"a missing directory throws TTS/VOICE_NOT_FOUND",
		voiceNotFound(() =>
			resolveSupertonicPaths(join(tmpdir(), "domia-supertonic-absent"), "int8"),
		),
	)
}

const main = (): void => {
	const checker = makeChecker()
	console.log("\n== supertonic model file discovery ==")
	int8Checks(checker)
	fp32Checks(checker)
	missingChecks(checker)
	const total = checker.passCount() + checker.failCount()
	console.log(`\n${checker.passCount()}/${total} tts-model-files checks passed`)
	if (checker.failCount() > 0) process.exit(1)
}

main()
