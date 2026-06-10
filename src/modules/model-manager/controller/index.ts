import { execFile } from "child_process"
import { promisify } from "util"
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
} from "fs"
import { basename, join, resolve } from "path"
import { Ollama } from "ollama"
import { env } from "@/config"
import { generateUuid, modelManagerLogger } from "@/utils"
import { modelInstallSpecSchema } from "../schemas"
import type {
	InstalledModelType,
	ModelInstallSpecType,
	ModelJobType,
	ModelsReportType,
} from "../types"

const execFileAsync = promisify(execFile)
const MODELS_DIR = resolve("data/models")
const CATALOG_PATH = resolve("data/models-catalog.json")
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000

const jobs = new Map<string, ModelJobType>()

const readCatalog = (): ModelInstallSpecType[] => {
	if (!existsSync(CATALOG_PATH)) return []
	try {
		const parsed: unknown = JSON.parse(readFileSync(CATALOG_PATH, "utf-8"))
		if (!Array.isArray(parsed)) return []
		return parsed.flatMap((entry) => {
			const result = modelInstallSpecSchema.safeParse(entry)
			return result.success ? [result.data] : []
		})
	} catch {
		return []
	}
}

const listOllama = async (): Promise<InstalledModelType[]> => {
	try {
		const client = new Ollama({ host: env.OLLAMA_HOST })
		const res = await client.list()
		return res.models.map((m) => ({
			name: m.name,
			kind: "ollama" as const,
			sizeBytes: m.size ?? null,
		}))
	} catch {
		return []
	}
}

export const listModels = async (): Promise<ModelsReportType> => {
	const installed: InstalledModelType[] = []
	if (existsSync(MODELS_DIR)) {
		for (const entry of readdirSync(MODELS_DIR, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) continue
			const isDir = entry.isDirectory()
			let sizeBytes: number | null = null
			if (!isDir) {
				try {
					sizeBytes = statSync(join(MODELS_DIR, entry.name)).size
				} catch {
					sizeBytes = null
				}
			}
			installed.push({
				name: entry.name,
				kind: isDir ? "dir" : "file",
				sizeBytes,
			})
		}
	}
	installed.push(...(await listOllama()))
	return { modelsDir: MODELS_DIR, installed, catalog: readCatalog() }
}

const runSherpaArchive = async (
	spec: Extract<ModelInstallSpecType, { kind: "sherpa-archive" }>,
): Promise<void> => {
	const target = join(MODELS_DIR, spec.target)
	if (existsSync(target)) return
	const archive = join(MODELS_DIR, basename(spec.url))
	await execFileAsync("curl", ["-fSL", "-o", archive, spec.url], {
		timeout: DOWNLOAD_TIMEOUT_MS,
	})
	await execFileAsync("tar", ["-xf", archive, "-C", MODELS_DIR], {
		timeout: DOWNLOAD_TIMEOUT_MS,
	})
	try {
		rmSync(archive)
	} catch {
		/* archive cleanup best-effort */
	}
	if (spec.sourceDir && spec.sourceDir !== spec.target)
		renameSync(join(MODELS_DIR, spec.sourceDir), target)
}

const runFile = async (
	spec: Extract<ModelInstallSpecType, { kind: "file" }>,
): Promise<void> => {
	const target = join(MODELS_DIR, spec.target)
	if (existsSync(target)) return
	await execFileAsync("curl", ["-fSL", "-o", target, spec.url], {
		timeout: DOWNLOAD_TIMEOUT_MS,
	})
}

const runOllama = async (
	spec: Extract<ModelInstallSpecType, { kind: "ollama" }>,
): Promise<void> => {
	const client = new Ollama({ host: env.OLLAMA_HOST })
	await client.pull({ model: spec.model })
}

const runInstall = async (job: ModelJobType): Promise<void> => {
	try {
		if (!existsSync(MODELS_DIR)) mkdirSync(MODELS_DIR, { recursive: true })
		if (job.spec.kind === "sherpa-archive") await runSherpaArchive(job.spec)
		else if (job.spec.kind === "file") await runFile(job.spec)
		else await runOllama(job.spec)
		job.status = "done"
		job.detail = "installed"
		modelManagerLogger.info("📦 model installed", { jobId: job.id })
	} catch (err) {
		job.status = "error"
		job.detail = err instanceof Error ? err.message : "install failed"
		modelManagerLogger.error("❌ model install failed", { jobId: job.id, err })
	} finally {
		job.finishedAt = Date.now()
	}
}

export const startInstall = (input: unknown): ModelJobType => {
	const spec = modelInstallSpecSchema.parse(input)
	const job: ModelJobType = {
		id: generateUuid(),
		spec,
		status: "running",
		detail: "starting",
		startedAt: Date.now(),
		finishedAt: null,
	}
	jobs.set(job.id, job)
	void runInstall(job)
	return job
}

export const getModelJob = (id: string): ModelJobType | null =>
	jobs.get(id) ?? null
