import type { SelectWakeWordConfigType } from "@/db"

export type AecBackendType = "PIPEWIRE" | "PULSEAUDIO"

export type AecStateType = "off" | "active" | "unavailable" | "failed"

export type AecStatusType = {
	state: AecStateType
	backend: AecBackendType | null
	moduleIndex: number | null
	sourceName: string | null
	sinkName: string | null
	holders: string[]
	detail: string | null
}

export type AecConfigType = Pick<
	SelectWakeWordConfigType,
	| "aecEnabled"
	| "aecBackend"
	| "aecMethod"
	| "aecSourceMaster"
	| "aecSinkMaster"
	| "aecSourceName"
	| "aecSinkName"
	| "aecSetDefaultDevices"
>

export type AecLoadedModuleType = {
	signature: string
	backend: AecBackendType
	moduleIndex: number
	sourceName: string
	sinkName: string
	previousDefaultSource: string | null
	previousDefaultSink: string | null
}

export type PactlResultType = {
	ok: boolean
	stdout: string
	stderr: string
}

export type PactlRunnerType = (args: string[]) => Promise<PactlResultType>

export type AecToolingType = {
	platform: NodeJS.Platform
	runPactl: PactlRunnerType
}
