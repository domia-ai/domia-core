import { generateUuid, now } from "@/utils"
import { type SelectRuntimeCapabilitiesType } from "@/db"

export const baseRuntimeCapabilities = (
	domiaId?: string,
): SelectRuntimeCapabilitiesType => ({
	id: generateUuid(),
	domiaId: domiaId ?? generateUuid(),
	wakeword: true,
	record: true,
	stt: true,
	intentDetection: true,
	intentExecution: true,
	promptGeneration: true,
	llm: true,
	tts: true,
	playback: true,
	createdAt: now(),
	updatedAt: now(),
})
