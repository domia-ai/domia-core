import type { DomiaType } from "@/modules/core"

export type ReloadSubsystemType =
	| "stt-pool"
	| "tts-pool"
	| "voice-listener"
	| "mqtt"
	| "skills"
	| "satellites"
	| "identity"

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

export type SubsystemStatusType = "live" | "reloaded" | "failed" | "skipped"

export type SubsystemOutcomeType = {
	subsystem: string
	status: SubsystemStatusType
	runningRevision?: number
	error?: string
}

export type ConfigApplyResultType = {
	result: "live" | "reloaded" | "partial" | "restart"
	desiredRevision: number
	subsystems: SubsystemOutcomeType[]
	drained: string[]
}

export type ConfigReloaderType = {
	scope: ReloaderScopeType
	reload: (domia: DomiaType, domiaKey: string) => Promise<void>
}

export type BusyCheckType = (domiaId: string) => boolean
