export type RuntimeCapabilitiesType = {
	wakeword: boolean
	record: boolean
	stt: boolean
	intentDetection: boolean
	intentExecution: boolean
	promptGeneration: boolean
	llm: boolean
	tts: boolean
	playback: boolean
}

export type PartialRuntimeCapabilitiesType = Partial<RuntimeCapabilitiesType>

export type RuntimeCapabilitiesValueType = {
	binaries?: { name: string; command: string; required: boolean }[]
	pythonModules?: string[]
	tempDirs?: string[]
}

export type CapabilityKeyType = keyof RuntimeCapabilitiesType

export type CapabilityResourcesType = Partial<
	Record<CapabilityKeyType, RuntimeCapabilitiesValueType>
>
