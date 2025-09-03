import type { RuntimeCapabilitiesType, CapabilityResourcesType } from "./types"

export const RUNTIME_CAPABILITIES: RuntimeCapabilitiesType = {
	wakeword: true,
	record: true,
	stt: true,
	intentDetection: true,
	intentExecution: true,
	promptGeneration: true,
	llm: true,
	tts: true,
	playback: true,
}

export const CAPABILITY_RESOURCES: CapabilityResourcesType = {
	wakeword: {
		pythonModules: ["sounddevice", "numpy", "openwakeword"],
	},
	record: {
		binaries: [{ name: "sox", command: "sox --version", required: true }],
		tempDirs: ["tmp", "tmp/recordings"],
	},
	stt: {
		pythonModules: ["vosk"],
	},
	tts: {
		pythonModules: ["piper"],
		tempDirs: ["tmp", "tmp/tts-output"],
	},
	playback: {
		binaries: [{ name: "sox", command: "sox --version", required: true }],
	},
}
