import type { z } from "zod"
import type { modelInstallSpecSchema } from "../schemas"

export type ModelInstallSpecType = z.infer<typeof modelInstallSpecSchema>

export type ModelJobStatusType = "running" | "done" | "error"

export type ModelJobType = {
	id: string
	spec: ModelInstallSpecType
	status: ModelJobStatusType
	detail: string
	startedAt: number
	finishedAt: number | null
}

export type InstalledModelType = {
	name: string
	kind: "dir" | "file" | "ollama"
	sizeBytes: number | null
}

export type ModelsReportType = {
	modelsDir: string
	installed: InstalledModelType[]
	catalog: ModelInstallSpecType[]
}
