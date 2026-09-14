import { generateUuid, now } from "@/utils"
import {
	DEFAULT_MESH_CONTROL_TOLERANCE_MS,
	DEFAULT_MESH_DROP_WARN_WINDOW_MS,
	DEFAULT_MODEL_DOWNLOAD_TIMEOUT_MS,
	DEFAULT_MODEL_INSTALL_MAX_BYTES,
	DEFAULT_MODEL_INSTALL_MAX_CONCURRENT_JOBS,
	DEFAULT_MODEL_INSTALL_MAX_REDIRECTS,
	DEFAULT_MODEL_JOB_RETENTION_MS,
	DEFAULT_PUBLIC_AUDIO_BASE_URL,
	type SelectHostNodeType,
} from "@/db"

export const baseHostNode = (): SelectHostNodeType => ({
	id: "singleton",
	nodeId: generateUuid(),
	configRevision: 0,
	meshControlToleranceMs: DEFAULT_MESH_CONTROL_TOLERANCE_MS,
	meshDropWarnWindowMs: DEFAULT_MESH_DROP_WARN_WINDOW_MS,
	modelDownloadTimeoutMs: DEFAULT_MODEL_DOWNLOAD_TIMEOUT_MS,
	modelInstallMaxBytes: DEFAULT_MODEL_INSTALL_MAX_BYTES,
	modelInstallMaxRedirects: DEFAULT_MODEL_INSTALL_MAX_REDIRECTS,
	modelInstallMaxConcurrentJobs: DEFAULT_MODEL_INSTALL_MAX_CONCURRENT_JOBS,
	modelJobRetentionMs: DEFAULT_MODEL_JOB_RETENTION_MS,
	publicAudioBaseUrl: DEFAULT_PUBLIC_AUDIO_BASE_URL,
	createdAt: now(),
	updatedAt: now(),
})
