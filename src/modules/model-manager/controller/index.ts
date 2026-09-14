import { execFile } from "child_process"
import { promisify } from "util"
import { createHash } from "crypto"
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
} from "fs"
import { pipeline } from "stream/promises"
import { dirname, join } from "path"
import { Ollama } from "ollama"
import {
	domiaError,
	generateUuid,
	modelManagerLogger,
	MODEL_MANAGER_ERRORS,
} from "@/utils"
import { getNodeConfig } from "@/modules/node-config"
import { modelInstallSpecSchema } from "../schemas"
import {
	archiveSuffix,
	findUnsafeArchiveEntry,
	findUnsafeArchiveEntryType,
	isAllowedInstallUrl,
	parseArchiveListing,
	resolveModelTargetPath,
} from "../utils"
import {
	ARCHIVE_LISTING_MAX_BUFFER_BYTES,
	CATALOG_PATH,
	MODELS_DIR,
	MODEL_STAGING_PREFIX,
} from "../constants"
import type {
	InstalledModelType,
	ModelDownloadIntegrityType,
	ModelInstallSpecType,
	ModelJobType,
	ModelsReportType,
} from "../types"

const execFileAsync = promisify(execFile)

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

const listOllama = async (
	ollamaHost: string,
): Promise<InstalledModelType[]> => {
	try {
		const client = new Ollama({ host: ollamaHost })
		const res = await client.list()
		return res.models.map((m) => ({
			name: m.name,
			kind: "ollama" as const,
			sizeBytes: m.size,
		}))
	} catch {
		return []
	}
}

const fileSize = (path: string): number | null => {
	try {
		return statSync(path).size
	} catch {
		return null
	}
}

const listDir = (dir: string, prefix: string): InstalledModelType[] => {
	if (!existsSync(dir)) return []
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => !entry.name.startsWith("."))
		.map((entry) => ({
			name: `${prefix}${entry.name}`,
			kind: entry.isDirectory() ? ("dir" as const) : ("file" as const),
			sizeBytes: entry.isDirectory() ? null : fileSize(join(dir, entry.name)),
		}))
}

export const catalogSubdirs = (
	catalog: readonly ModelInstallSpecType[],
): string[] => [
	...new Set(
		catalog.flatMap((spec) =>
			spec.kind !== "ollama" && spec.subdir ? [spec.subdir] : [],
		),
	),
]

export const listModels = async (
	ollamaHost: string,
): Promise<ModelsReportType> => {
	const catalog = readCatalog()
	const installed = listDir(MODELS_DIR, "")
	for (const subdir of catalogSubdirs(catalog)) {
		const dir = resolveModelTargetPath(MODELS_DIR, subdir)
		if (dir) installed.push(...listDir(dir, `${subdir}/`))
	}
	installed.push(...(await listOllama(ollamaHost)))
	return { modelsDir: MODELS_DIR, installed, catalog }
}

const discard = (path: string): void => {
	try {
		rmSync(path, { recursive: true, force: true })
	} catch (err) {
		modelManagerLogger.warn("model staging cleanup failed", { path, err })
	}
}

const sweepStaleStaging = (): void => {
	if (!existsSync(MODELS_DIR)) return
	const cutoff = Date.now() - 2 * getNodeConfig().modelDownloadTimeoutMs
	for (const entry of readdirSync(MODELS_DIR, { withFileTypes: true })) {
		if (!entry.name.startsWith(MODEL_STAGING_PREFIX)) continue
		const path = join(MODELS_DIR, entry.name)
		try {
			if (statSync(path).mtimeMs < cutoff) discard(path)
		} catch (err) {
			modelManagerLogger.warn("model staging sweep failed", { path, err })
		}
	}
}

const withStagingDir = async <T>(
	run: (dir: string) => Promise<T>,
): Promise<T> => {
	const dir = join(MODELS_DIR, `${MODEL_STAGING_PREFIX}${generateUuid()}`)
	mkdirSync(dir, { recursive: true })
	try {
		return await run(dir)
	} finally {
		discard(dir)
	}
}

const assertAllowedUrl = (
	url: string,
	allowedHosts: readonly string[],
): void => {
	if (isAllowedInstallUrl(url, allowedHosts)) return
	throw domiaError(MODEL_MANAGER_ERRORS.INSTALL_HOST_NOT_ALLOWED, {
		meta: { url, allowedHosts },
		logger: modelManagerLogger,
	})
}

const openDownload = async (
	url: string,
	allowedHosts: readonly string[],
	signal: AbortSignal,
): Promise<Response> => {
	let current = url
	const maxRedirects = getNodeConfig().modelInstallMaxRedirects
	for (let hop = 0; hop <= maxRedirects; hop++) {
		assertAllowedUrl(current, allowedHosts)
		const res = await fetch(current, { redirect: "manual", signal })
		const location = res.headers.get("location")
		if (res.status >= 300 && res.status < 400 && location) {
			await res.body?.cancel()
			current = new URL(location, current).toString()
			continue
		}
		if (!res.ok) {
			await res.body?.cancel()
			throw domiaError(MODEL_MANAGER_ERRORS.DOWNLOAD_FAILED, {
				meta: { url: current, status: res.status },
				logger: modelManagerLogger,
			})
		}
		return res
	}
	throw domiaError(MODEL_MANAGER_ERRORS.TOO_MANY_REDIRECTS, {
		meta: { url, maxRedirects },
		logger: modelManagerLogger,
	})
}

const downloadTo = async (
	url: string,
	destination: string,
	allowedHosts: readonly string[],
	integrity: ModelDownloadIntegrityType,
): Promise<void> => {
	const controller = new AbortController()
	const { modelDownloadTimeoutMs, modelInstallMaxBytes } = getNodeConfig()
	const timer = setTimeout(() => controller.abort(), modelDownloadTimeoutMs)
	const limit = Math.min(
		integrity.sizeBytes ?? modelInstallMaxBytes,
		modelInstallMaxBytes,
	)
	try {
		const res = await openDownload(url, allowedHosts, controller.signal)
		const body = res.body as ReadableStream<Uint8Array> | null
		if (!body)
			throw domiaError(MODEL_MANAGER_ERRORS.DOWNLOAD_FAILED, {
				meta: { url, status: res.status },
				logger: modelManagerLogger,
			})
		const declared = Number(res.headers.get("content-length"))
		if (Number.isFinite(declared) && declared > limit)
			throw domiaError(MODEL_MANAGER_ERRORS.DOWNLOAD_TOO_LARGE, {
				meta: { url, declared, limit },
				logger: modelManagerLogger,
			})
		const digest = createHash("sha256")
		let received = 0
		const chunks = async function* () {
			const reader = body.getReader()
			for (;;) {
				const { done, value } = await reader.read()
				if (done) return
				received += value.byteLength
				if (received > limit) {
					await reader.cancel()
					throw domiaError(MODEL_MANAGER_ERRORS.DOWNLOAD_TOO_LARGE, {
						meta: { url, received, limit },
						logger: modelManagerLogger,
					})
				}
				digest.update(value)
				yield Buffer.from(value.buffer, value.byteOffset, value.byteLength)
			}
		}
		await pipeline(chunks(), createWriteStream(destination))
		const sha256 = digest.digest("hex")
		const sizeMismatch =
			integrity.sizeBytes !== undefined && received !== integrity.sizeBytes
		const digestMismatch =
			integrity.sha256 !== undefined &&
			sha256 !== integrity.sha256.toLowerCase()
		if (received === 0 || sizeMismatch || digestMismatch)
			throw domiaError(MODEL_MANAGER_ERRORS.DOWNLOAD_VERIFICATION_FAILED, {
				meta: {
					url,
					received,
					expectedSizeBytes: integrity.sizeBytes ?? null,
					expectedSha256: integrity.sha256 ?? null,
					sha256,
				},
				logger: modelManagerLogger,
			})
	} finally {
		clearTimeout(timer)
	}
}

const assertSafeArchive = async (archive: string): Promise<void> => {
	const options = {
		timeout: getNodeConfig().modelDownloadTimeoutMs,
		maxBuffer: ARCHIVE_LISTING_MAX_BUFFER_BYTES,
	}
	const names = await execFileAsync("tar", ["-tf", archive], options)
	const unsafeName = findUnsafeArchiveEntry(parseArchiveListing(names.stdout))
	if (unsafeName !== null)
		throw domiaError(MODEL_MANAGER_ERRORS.UNSAFE_ARCHIVE_ENTRY, {
			meta: { archive, entry: unsafeName },
			logger: modelManagerLogger,
		})
	const detailed = await execFileAsync("tar", ["-tvf", archive], options)
	const unsafeType = findUnsafeArchiveEntryType(
		parseArchiveListing(detailed.stdout),
	)
	if (unsafeType !== null)
		throw domiaError(MODEL_MANAGER_ERRORS.UNSAFE_ARCHIVE_ENTRY, {
			meta: { archive, entry: unsafeType },
			logger: modelManagerLogger,
		})
}

const installTarget = (
	spec: Extract<ModelInstallSpecType, { kind: "sherpa-archive" | "file" }>,
): string => {
	const resolved = resolveModelTargetPath(MODELS_DIR, spec.target, spec.subdir)
	if (resolved === null)
		throw domiaError(MODEL_MANAGER_ERRORS.UNSAFE_TARGET_PATH, {
			meta: { modelsDir: MODELS_DIR, subdir: spec.subdir, target: spec.target },
			logger: modelManagerLogger,
		})
	return resolved
}

const runSherpaArchive = async (
	spec: Extract<ModelInstallSpecType, { kind: "sherpa-archive" }>,
	allowedHosts: readonly string[],
): Promise<void> => {
	const target = installTarget(spec)
	if (existsSync(target)) return
	const sourceName = spec.sourceDir ?? spec.target
	await withStagingDir(async (dir) => {
		const archive = join(dir, `archive${archiveSuffix(spec.url)}`)
		await downloadTo(spec.url, archive, allowedHosts, spec)
		await assertSafeArchive(archive)
		const extracted = join(dir, "extracted")
		mkdirSync(extracted, { recursive: true })
		await execFileAsync("tar", ["-xf", archive, "-C", extracted], {
			timeout: getNodeConfig().modelDownloadTimeoutMs,
		})
		const produced = join(extracted, sourceName)
		if (!existsSync(produced))
			throw domiaError(MODEL_MANAGER_ERRORS.ARCHIVE_CONTENT_MISSING, {
				meta: { url: spec.url, expected: sourceName },
				logger: modelManagerLogger,
			})
		if (existsSync(target)) return
		mkdirSync(dirname(target), { recursive: true })
		renameSync(produced, target)
	})
}

const runFile = async (
	spec: Extract<ModelInstallSpecType, { kind: "file" }>,
	allowedHosts: readonly string[],
): Promise<void> => {
	const target = installTarget(spec)
	if (existsSync(target)) return
	await withStagingDir(async (dir) => {
		const staged = join(dir, "download")
		await downloadTo(spec.url, staged, allowedHosts, spec)
		if (existsSync(target)) return
		mkdirSync(dirname(target), { recursive: true })
		renameSync(staged, target)
	})
}

const runOllama = async (
	spec: Extract<ModelInstallSpecType, { kind: "ollama" }>,
	ollamaHost: string,
): Promise<void> => {
	const client = new Ollama({ host: ollamaHost })
	await client.pull({ model: spec.model })
}

const runInstall = async (
	job: ModelJobType,
	ollamaHost: string,
	allowedHosts: readonly string[],
): Promise<void> => {
	try {
		if (!existsSync(MODELS_DIR)) mkdirSync(MODELS_DIR, { recursive: true })
		sweepStaleStaging()
		if (job.spec.kind === "sherpa-archive")
			await runSherpaArchive(job.spec, allowedHosts)
		else if (job.spec.kind === "file") await runFile(job.spec, allowedHosts)
		else await runOllama(job.spec, ollamaHost)
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

const pruneFinishedJobs = (): void => {
	const cutoff = Date.now() - getNodeConfig().modelJobRetentionMs
	for (const [id, job] of jobs)
		if (job.finishedAt !== null && job.finishedAt <= cutoff) jobs.delete(id)
}

const runningJobCount = (): number => {
	let running = 0
	for (const job of jobs.values()) if (job.status === "running") running++
	return running
}

export const startInstall = (
	input: unknown,
	ollamaHost: string,
	allowedHosts: readonly string[],
): ModelJobType => {
	const spec = modelInstallSpecSchema.parse(input)
	if (spec.kind !== "ollama") {
		assertAllowedUrl(spec.url, allowedHosts)
		installTarget(spec)
	}
	pruneFinishedJobs()
	const running = runningJobCount()
	const maxConcurrent = getNodeConfig().modelInstallMaxConcurrentJobs
	if (running >= maxConcurrent)
		throw domiaError(MODEL_MANAGER_ERRORS.TOO_MANY_INSTALL_JOBS, {
			meta: { running, maxConcurrent },
			logger: modelManagerLogger,
		})
	const job: ModelJobType = {
		id: generateUuid(),
		spec,
		status: "running",
		detail: "starting",
		startedAt: Date.now(),
		finishedAt: null,
	}
	jobs.set(job.id, job)
	void runInstall(job, ollamaHost, allowedHosts)
	return job
}

export const getModelJob = (id: string): ModelJobType | null => {
	pruneFinishedJobs()
	return jobs.get(id) ?? null
}
