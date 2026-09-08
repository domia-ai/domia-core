import { resolve } from "path"

export const MODELS_DIR = resolve("data/models")
export const CATALOG_PATH = resolve("data/models-catalog.json")

export const MODEL_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000
export const MODEL_INSTALL_MAX_BYTES = 12 * 1024 * 1024 * 1024
export const MODEL_INSTALL_MAX_REDIRECTS = 5
export const MODEL_INSTALL_MAX_CONCURRENT_JOBS = 2
export const MODEL_JOB_RETENTION_MS = 30 * 60 * 1000
export const MODEL_STAGING_PREFIX = ".staging-"
export const MODEL_STAGING_RETENTION_MS = 2 * MODEL_DOWNLOAD_TIMEOUT_MS
export const ARCHIVE_LISTING_MAX_BUFFER_BYTES = 64 * 1024 * 1024
