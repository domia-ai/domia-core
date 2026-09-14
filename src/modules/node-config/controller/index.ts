import {
	dbClient,
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
import {
	configEngineLogger,
	CORE_ERRORS,
	createKeyedMutex,
	domiaError,
} from "@/utils"

import dbAdapter from "../db-adapter"
import {
	NODE_CONFIG_BUNDLE_VERSION,
	NODE_CONFIG_MUTEX_KEY,
	NODE_LIVE_FIELDS,
	NODE_SUBSYSTEMS,
} from "../constants"
import { nodeConfigBundleSchema } from "../schemas"
import type {
	NodeConfigApplyResultType,
	NodeConfigSnapshotType,
	NodeConfigType,
	NodeSubsystemType,
} from "../types"

const DEFAULT_NODE_CONFIG: NodeConfigType = {
	meshControlToleranceMs: DEFAULT_MESH_CONTROL_TOLERANCE_MS,
	meshDropWarnWindowMs: DEFAULT_MESH_DROP_WARN_WINDOW_MS,
	modelDownloadTimeoutMs: DEFAULT_MODEL_DOWNLOAD_TIMEOUT_MS,
	modelInstallMaxBytes: DEFAULT_MODEL_INSTALL_MAX_BYTES,
	modelInstallMaxRedirects: DEFAULT_MODEL_INSTALL_MAX_REDIRECTS,
	modelInstallMaxConcurrentJobs: DEFAULT_MODEL_INSTALL_MAX_CONCURRENT_JOBS,
	modelJobRetentionMs: DEFAULT_MODEL_JOB_RETENTION_MS,
	publicAudioBaseUrl: DEFAULT_PUBLIC_AUDIO_BASE_URL,
}

const NODE_CONFIG_FIELDS = Object.keys(
	DEFAULT_NODE_CONFIG,
) as (keyof NodeConfigType)[]

const runExclusive = createKeyedMutex()

let cachedConfig: NodeConfigType = DEFAULT_NODE_CONFIG

export const serializeNodeConfig = (
	row: SelectHostNodeType,
): NodeConfigSnapshotType => ({
	version: NODE_CONFIG_BUNDLE_VERSION,
	revision: row.configRevision,
	node: {
		meshControlToleranceMs: row.meshControlToleranceMs,
		meshDropWarnWindowMs: row.meshDropWarnWindowMs,
		modelDownloadTimeoutMs: row.modelDownloadTimeoutMs,
		modelInstallMaxBytes: row.modelInstallMaxBytes,
		modelInstallMaxRedirects: row.modelInstallMaxRedirects,
		modelInstallMaxConcurrentJobs: row.modelInstallMaxConcurrentJobs,
		modelJobRetentionMs: row.modelJobRetentionMs,
		publicAudioBaseUrl: row.publicAudioBaseUrl,
	},
})

const cache = (row: SelectHostNodeType): NodeConfigSnapshotType => {
	const snapshot = serializeNodeConfig(row)
	cachedConfig = snapshot.node
	return snapshot
}

const requireHostNode = async (): Promise<SelectHostNodeType> => {
	const row = await dbAdapter.getHostNode()
	if (!row) throw domiaError(CORE_ERRORS.HOST_NODE_MISSING)
	return row
}

export const getNodeConfig = (): NodeConfigType => cachedConfig

export const loadNodeConfig = async (): Promise<NodeConfigSnapshotType> =>
	cache(await requireHostNode())

const subsystemsFor = (
	changed: (keyof NodeConfigType)[],
): NodeSubsystemType[] =>
	NODE_SUBSYSTEMS.filter((subsystem) =>
		NODE_LIVE_FIELDS[subsystem].some((field) => changed.includes(field)),
	)

export const applyNodeConfig = (
	input: unknown,
): Promise<NodeConfigApplyResultType> =>
	runExclusive(NODE_CONFIG_MUTEX_KEY, async () => {
		const bundle = nodeConfigBundleSchema.parse(input)
		const patch = bundle.node ?? {}
		const row = await requireHostNode()
		const changed = NODE_CONFIG_FIELDS.filter(
			(field) => field in patch && patch[field] !== row[field],
		)
		if (changed.length === 0) {
			const snapshot = cache(row)
			return {
				applied: true as const,
				revision: snapshot.revision,
				changed,
				reloaded: [],
			}
		}
		dbClient.transaction((tx) => {
			dbAdapter.materializeHostNode(row.id, patch, tx).run()
			dbAdapter.bumpNodeConfigRevision(row.id, tx).run()
		})
		const snapshot = cache(await requireHostNode())
		const reloaded = subsystemsFor(changed)
		configEngineLogger.info("🔧 node config applied", {
			revision: snapshot.revision,
			changed,
			reloaded,
		})
		return {
			applied: true as const,
			revision: snapshot.revision,
			changed,
			reloaded,
		}
	})
