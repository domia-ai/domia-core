import { relative, sep } from "path"

import {
	MODELS_DIR,
	catalogSubdirs,
	listModels,
	modelInstallSpecSchema,
	resolveModelTargetPath,
} from "@/modules/model-manager"

import { makeChecker } from "./lib/assert"
import type { CheckerType } from "./types"

const GGUF_TARGETS = [
	"llama-3.2-3b-instruct-q4_k_m.gguf",
	"qwen3.5-4b-q4_k_m.gguf",
	"lfm2.5-2.6b-qad-q4_0.gguf",
]

const pathChecks = (checker: CheckerType): void => {
	console.log("\n== install target resolution ==")
	const flat = resolveModelTargetPath(MODELS_DIR, "silero_vad.onnx")
	checker.check(
		"a flat target lands directly in the models dir",
		flat !== null && relative(MODELS_DIR, flat) === "silero_vad.onnx",
		String(flat),
	)

	const nested = resolveModelTargetPath(
		MODELS_DIR,
		"qwen3.5-4b-q4_k_m.gguf",
		"gguf",
	)
	checker.check(
		"a subdir target lands in <models>/gguf/<target>",
		nested !== null &&
			relative(MODELS_DIR, nested) === `gguf${sep}qwen3.5-4b-q4_k_m.gguf`,
		String(nested),
	)
	checker.check(
		"the resolved subdir path stays under the models dir",
		nested !== null && !relative(MODELS_DIR, nested).startsWith(".."),
		String(nested),
	)

	checker.check(
		"reject: target '..'",
		resolveModelTargetPath(MODELS_DIR, "..") === null,
	)
	checker.check(
		"reject: subdir '..'",
		resolveModelTargetPath(MODELS_DIR, "model.onnx", "..") === null,
	)
	checker.check(
		"reject: subdir '.' with target '..'",
		resolveModelTargetPath(MODELS_DIR, "..", ".") === null,
	)
	checker.check(
		"reject: subdir with a path separator",
		resolveModelTargetPath(MODELS_DIR, "model.onnx", "../etc") === null,
	)
	checker.check(
		"reject: absolute target",
		resolveModelTargetPath(MODELS_DIR, "/etc/passwd") === null,
	)
	checker.check(
		"reject: target that resolves onto the models dir itself",
		resolveModelTargetPath(MODELS_DIR, ".") === null,
	)
}

const schemaChecks = (checker: CheckerType): void => {
	console.log("\n== install spec schema ==")
	const good = modelInstallSpecSchema.safeParse({
		kind: "file",
		label: "Qwen3.5 4B",
		stage: "llm",
		license: "Apache-2.0",
		url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
		subdir: "gguf",
		target: "qwen3.5-4b-q4_k_m.gguf",
	})
	checker.check(
		"a file spec accepts license + subdir",
		good.success &&
			good.data.kind === "file" &&
			good.data.subdir === "gguf" &&
			good.data.license === "Apache-2.0",
		good.success ? "" : JSON.stringify(good.error.issues),
	)

	const separator = modelInstallSpecSchema.safeParse({
		kind: "file",
		url: "https://huggingface.co/x/y.gguf",
		subdir: "gguf/nested",
		target: "y.gguf",
	})
	checker.check(
		"reject: a subdir with a path separator never parses",
		!separator.success,
	)

	const legacy = modelInstallSpecSchema.safeParse({
		kind: "file",
		url: "https://github.com/x/silero_vad.onnx",
		target: "silero_vad.onnx",
	})
	checker.check(
		"a spec without license or subdir still parses",
		legacy.success &&
			legacy.data.kind === "file" &&
			legacy.data.subdir === undefined &&
			legacy.data.license === undefined,
	)
}

const catalogChecks = async (checker: CheckerType): Promise<void> => {
	console.log("\n== GET /models catalog ==")
	const report = await listModels("http://127.0.0.1:1")
	checker.check(
		"the catalog parses at least the shipped entries",
		report.catalog.length >= 10,
		String(report.catalog.length),
	)

	for (const target of GGUF_TARGETS) {
		const entry = report.catalog.find(
			(e) => e.kind === "file" && e.target === target,
		)
		checker.check(`catalog lists ${target}`, entry !== undefined)
		if (entry?.kind !== "file") continue
		checker.check(
			`${target} installs into the gguf subdir`,
			entry.subdir === "gguf",
			String(entry.subdir),
		)
		checker.check(
			`${target} carries a license through GET /models`,
			typeof entry.license === "string" && entry.license.length > 0,
			String(entry.license),
		)
		const resolved = resolveModelTargetPath(
			MODELS_DIR,
			entry.target,
			entry.subdir,
		)
		checker.check(
			`${target} resolves under <models>/gguf`,
			resolved !== null &&
				relative(MODELS_DIR, resolved) === `gguf${sep}${target}`,
			String(resolved),
		)
	}

	checker.check(
		"the gguf subdir is derived from the catalog",
		catalogSubdirs(report.catalog).includes("gguf"),
		catalogSubdirs(report.catalog).join(","),
	)
	checker.check(
		"a subdir never widens beyond the catalog's own entries",
		catalogSubdirs(report.catalog).every(
			(subdir) => resolveModelTargetPath(MODELS_DIR, subdir) !== null,
		),
	)
	checker.check(
		"installed rows from a subdir are prefixed with it",
		report.installed
			.filter((m) => m.name.startsWith("gguf/"))
			.every((m) => m.kind === "file"),
		report.installed
			.filter((m) => m.name.startsWith("gguf/"))
			.map((m) => m.name)
			.join(","),
	)

	const lfm = report.catalog.find(
		(e) => e.kind === "file" && e.target === "lfm2.5-2.6b-qad-q4_0.gguf",
	)
	checker.check(
		"the LFM entry states its revenue threshold and never-default status",
		lfm?.license !== undefined &&
			/10M/i.test(lfm.license) &&
			/never a default/i.test(lfm.license),
		String(lfm?.license),
	)
}

const main = async (): Promise<void> => {
	const checker = makeChecker()
	pathChecks(checker)
	schemaChecks(checker)
	await catalogChecks(checker)
	const total = checker.passCount() + checker.failCount()
	console.log(`\n${checker.passCount()}/${total} model-catalog checks passed`)
	if (checker.failCount() > 0) process.exit(1)
}

void main()
