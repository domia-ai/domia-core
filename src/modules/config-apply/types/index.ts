import type { ConfigSnapshotType } from "@/modules/config"
import type { DomiaType } from "@/modules/core"

export type ReloadSubsystemType =
	| "stt-pool"
	| "tts-pool"
	| "voice-listener"
	| "mqtt"
	| "skills"
	| "satellites"
	| "identity"
	| "proactivity"

export type ReloaderScopeType = "global" | "per-identity"

export type ChangeActionType =
	| "live"
	| "live-drain"
	| "identity"
	| "restart"
	| ReloadSubsystemType

export type ConfigChangeType = { section: string; field: string }

export type ConfigApplyPlanType = {
	live: boolean
	liveDrain: boolean
	reloads: Map<ReloadSubsystemType, ReloaderScopeType>
	identity: boolean
	restart: boolean
}

export type SubsystemStatusType =
	| "live"
	| "reloaded"
	| "failed"
	| "reverted"
	| "skipped"

export type SubsystemOutcomeType = {
	subsystem: string
	status: SubsystemStatusType
	desiredRevision?: number
	runningRevision?: number
	error?: string
}

export type ConfigApplyResultType = {
	result: "live" | "reloaded" | "partial" | "reverted" | "restart"
	desiredRevision: number
	subsystems: SubsystemOutcomeType[]
	drained: string[]
	revertedSections: string[]
	reconciled: ReloadSubsystemType[]
}

export type ConfigReloaderType = {
	scope: ReloaderScopeType
	reload: (domia: DomiaType, domiaKey: string) => Promise<void>
}

export type BusyCheckType = (domiaId: string) => boolean

export type SubsystemRevisionStateType = {
	subsystem: ReloadSubsystemType
	desiredRevision: number
	runningRevision: number
	inSync: boolean
	lastError: string | null
	lastErrorAt: string | null
}

export type ConfigApplyStateType = {
	domiaKey: string
	inSync: boolean
	pending: ReloadSubsystemType[]
	subsystems: SubsystemRevisionStateType[]
}

export type ApplyStateType = {
	markDesired: (
		domiaKey: string,
		subsystem: ReloadSubsystemType,
		revision: number,
	) => void
	markRunning: (
		domiaKey: string,
		subsystem: ReloadSubsystemType,
		revision: number,
	) => void
	markFailed: (
		domiaKey: string,
		subsystem: ReloadSubsystemType,
		revision: number,
		error: string,
	) => void
	markReverted: (
		domiaKey: string,
		subsystem: ReloadSubsystemType,
		revision: number,
	) => void
	runningRevision: (domiaKey: string, subsystem: ReloadSubsystemType) => number
	pending: (domiaKey: string) => ReloadSubsystemType[]
	snapshot: (domiaKey: string) => ConfigApplyStateType
}

export type ConfigRevertBundleType = Record<string, Record<string, unknown>>

export type ConfigRevertPlanType = {
	bundle: ConfigRevertBundleType
	subsystems: ReloadSubsystemType[]
	sections: string[]
	unrevertable: ReloadSubsystemType[]
}

export type ReloadRunnerDepsType = {
	state: ApplyStateType
	hostedIds: () => Promise<string[]>
	resolveLatest: (domiaKey: string) => Promise<DomiaType | undefined>
	quiesce: (domiaIds: string[], drainMs: number) => Promise<void>
	runExclusive: <T>(key: string, fn: () => Promise<T>) => Promise<T>
}

export type ReloadRunInputType = {
	subsystem: ReloadSubsystemType
	scope: ReloaderScopeType
	reloader: ConfigReloaderType
	domia: DomiaType
	domiaKey: string
	desiredRevision: number
	drainMs: number
}

export type ReloadRunResultType = {
	outcome: SubsystemOutcomeType
	drainedIds: string[]
}

export type ReloadRunnerType = {
	run: (input: ReloadRunInputType) => Promise<ReloadRunResultType>
}

export type ConfigPersistResultType = { config: ConfigSnapshotType }

export type ConfigApplyOutcomeType = {
	config: ConfigSnapshotType
	apply: ConfigApplyResultType
}

export type ConfigRevertOutcomeType = {
	outcomes: SubsystemOutcomeType[]
	sections: string[]
	config?: ConfigSnapshotType
}

export type ConfigApplyEngineDepsType = {
	state: ApplyStateType
	runner: ReloadRunnerType
	reloaderFor: (
		subsystem: ReloadSubsystemType,
	) => ConfigReloaderType | undefined
	persist: (
		domia: DomiaType,
		input: unknown,
	) => Promise<ConfigPersistResultType>
	resolve: (domiaKey: string) => Promise<DomiaType | undefined>
	quiesce: (domiaIds: string[], drainMs: number) => Promise<void>
	runExclusive: <T>(key: string, fn: () => Promise<T>) => Promise<T>
	onLlmClientStale: () => void
	requestRestart: () => void
	defaultDrainMs: number
}

export type ConfigApplyEngineType = {
	applyConfig: (
		domia: DomiaType,
		input: unknown,
	) => Promise<ConfigApplyOutcomeType>
	reloadSubsystem: (
		subsystem: ReloadSubsystemType,
		domiaKey: string,
	) => Promise<ConfigApplyResultType>
}
