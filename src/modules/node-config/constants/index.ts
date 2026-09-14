import type { NodeConfigType, NodeSubsystemType } from "../types"

export const NODE_CONFIG_BUNDLE_VERSION = 1

export const NODE_CONFIG_MUTEX_KEY = "node-config"

export const NODE_META_FIELDS = [
	"id",
	"nodeId",
	"configRevision",
	"createdAt",
	"updatedAt",
] as const

export const NODE_LIVE_FIELDS: Record<
	NodeSubsystemType,
	readonly (keyof NodeConfigType)[]
> = {
	mesh: ["meshControlToleranceMs", "meshDropWarnWindowMs"],
	"model-manager": [
		"modelDownloadTimeoutMs",
		"modelInstallMaxBytes",
		"modelInstallMaxRedirects",
		"modelInstallMaxConcurrentJobs",
		"modelJobRetentionMs",
	],
	audio: ["publicAudioBaseUrl"],
}

export const NODE_SUBSYSTEMS: NodeSubsystemType[] = [
	"mesh",
	"model-manager",
	"audio",
]

export const MESH_CONTROL_TOLERANCE_HARD_MAX_MS = 600_000
export const MESH_DROP_WARN_WINDOW_HARD_MAX_MS = 3_600_000
export const MODEL_DOWNLOAD_TIMEOUT_HARD_MAX_MS = 21_600_000
export const MODEL_INSTALL_HARD_MAX_BYTES = 256 * 1024 * 1024 * 1024
export const MODEL_INSTALL_HARD_MAX_REDIRECTS = 20
export const MODEL_INSTALL_HARD_MAX_CONCURRENT_JOBS = 8
export const MODEL_JOB_RETENTION_HARD_MAX_MS = 604_800_000
export const PUBLIC_AUDIO_BASE_URL_MAX_CHARS = 512
