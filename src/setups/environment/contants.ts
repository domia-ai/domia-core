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
	record: {
		binaries: [
			{ name: "sox", command: "sox --version", required: true },
			{ name: "rec", command: "rec --version", required: true },
		],
		tempDirs: ["tmp", "tmp/recordings"],
	},
	tts: {
		tempDirs: ["tmp", "tmp/tts-output"],
	},
	playback: {
		binaries: [{ name: "sox", command: "sox --version", required: true }],
	},
}
