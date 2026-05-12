import { type DomiaType } from "@/modules/core"
import { type RuntimeCapabilitiesType } from "@/setups/environment"
import { getSttEngine } from "@/modules/stt-engine"
import { getTtsEngine } from "@/modules/tts-engine"
import { getLlmEngine } from "@/modules/llm-engine"
import type {
	CoreBusFeaturesType,
	ResolvedSttEngineType,
	ResolvedTtsEngineType,
	ResolvedLlmEngineType,
} from "../types"

const resolveStt = (domia: DomiaType): ResolvedSttEngineType => {
	const engineId = domia.sttConfig?.engine
	const adapter = engineId ? getSttEngine(engineId) : null
	if (!adapter) return null
	return {
		adapter,
		canStream:
			adapter.capabilities.streaming === true &&
			typeof adapter.runStream === "function",
	}
}

const resolveTts = (domia: DomiaType): ResolvedTtsEngineType => {
	const engineId = domia.ttsConfig?.engine
	const adapter = engineId ? getTtsEngine(engineId) : null
	if (!adapter) return null
	return {
		adapter,
		canStream:
			adapter.capabilities.streaming === true &&
			typeof adapter.runStream === "function",
	}
}

const resolveLlm = (domia: DomiaType): ResolvedLlmEngineType => {
	const engineId = domia.llmModelConfig?.engine
	const adapter = engineId ? getLlmEngine(engineId) : null
	if (!adapter) return null
	return {
		adapter,
		canStream:
			adapter.capabilities.streaming === true &&
			typeof adapter.runStream === "function",
	}
}

export const resolveCoreBusFeatures = (
	domia: DomiaType,
	capabilities: RuntimeCapabilitiesType,
): CoreBusFeaturesType => {
	const stt = resolveStt(domia)
	const tts = resolveTts(domia)
	const llm = resolveLlm(domia)

	const canRunStt = capabilities.stt && stt !== null
	const canRunLlm = capabilities.llm && llm !== null
	const canRunTts = capabilities.tts && tts !== null
	const canPlayback = capabilities.playback

	const canStreamStt = canRunStt && stt?.canStream === true
	const canStreamLlm = canRunLlm && llm?.canStream === true
	const canStreamTts = canRunTts && tts?.canStream === true

	const canFullStreamVoice = canStreamLlm && canStreamTts && canPlayback

	return {
		capabilities,
		stt,
		tts,
		llm,
		canRunStt,
		canRunLlm,
		canRunTts,
		canPlayback,
		canStreamStt,
		canStreamLlm,
		canStreamTts,
		canFullStreamVoice,
	}
}
