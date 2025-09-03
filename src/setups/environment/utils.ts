import { type SelectRuntimeCapabilitiesType } from "@/db"
import { RuntimeCapabilitiesType } from "./types"

export const normalizeRuntimeCapabilities = (
	raw: Partial<SelectRuntimeCapabilitiesType> = {},
): RuntimeCapabilitiesType => {
	return {
		wakeword: raw?.wakeword ?? true,
		record: raw?.record ?? true,
		stt: raw?.stt ?? true,
		intentDetection: raw?.intentDetection ?? true,
		intentExecution: raw?.intentExecution ?? true,
		promptGeneration: raw?.promptGeneration ?? true,
		llm: raw?.llm ?? true,
		tts: raw?.tts ?? true,
		playback: raw?.playback ?? true,
	}
}
