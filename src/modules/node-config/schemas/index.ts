import { z } from "zod"

import {
	MESH_CONTROL_TOLERANCE_HARD_MAX_MS,
	MESH_DROP_WARN_WINDOW_HARD_MAX_MS,
	MODEL_DOWNLOAD_TIMEOUT_HARD_MAX_MS,
	MODEL_INSTALL_HARD_MAX_BYTES,
	MODEL_INSTALL_HARD_MAX_CONCURRENT_JOBS,
	MODEL_INSTALL_HARD_MAX_REDIRECTS,
	MODEL_JOB_RETENTION_HARD_MAX_MS,
	NODE_CONFIG_BUNDLE_VERSION,
	PUBLIC_AUDIO_BASE_URL_MAX_CHARS,
} from "../constants"

const boundedInt = (min: number, max: number) =>
	z.number().int().min(min).max(max)

const publicAudioBaseUrl = z
	.string()
	.max(PUBLIC_AUDIO_BASE_URL_MAX_CHARS)
	.refine((value) => {
		try {
			return /^https?:$/.test(new URL(value).protocol)
		} catch {
			return false
		}
	}, "must be an http(s) base URL")

export const nodeConfigSectionSchema = z
	.object({
		meshControlToleranceMs: boundedInt(
			1_000,
			MESH_CONTROL_TOLERANCE_HARD_MAX_MS,
		),
		meshDropWarnWindowMs: boundedInt(0, MESH_DROP_WARN_WINDOW_HARD_MAX_MS),
		modelDownloadTimeoutMs: boundedInt(
			1_000,
			MODEL_DOWNLOAD_TIMEOUT_HARD_MAX_MS,
		),
		modelInstallMaxBytes: boundedInt(1, MODEL_INSTALL_HARD_MAX_BYTES),
		modelInstallMaxRedirects: boundedInt(0, MODEL_INSTALL_HARD_MAX_REDIRECTS),
		modelInstallMaxConcurrentJobs: boundedInt(
			1,
			MODEL_INSTALL_HARD_MAX_CONCURRENT_JOBS,
		),
		modelJobRetentionMs: boundedInt(0, MODEL_JOB_RETENTION_HARD_MAX_MS),
		publicAudioBaseUrl: publicAudioBaseUrl.nullable(),
	})
	.partial()
	.strict()

export const nodeConfigBundleSchema = z
	.object({
		version: z.number().int().positive().max(NODE_CONFIG_BUNDLE_VERSION),
		node: nodeConfigSectionSchema,
	})
	.partial()
	.strict()
