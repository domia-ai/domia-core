import { resolve } from "path"

export const MODELS_DIR = resolve("data/models")
export const CATALOG_PATH = resolve("data/models-catalog.json")

export const MODEL_STAGING_PREFIX = ".staging-"
export const ARCHIVE_LISTING_MAX_BUFFER_BYTES = 64 * 1024 * 1024
