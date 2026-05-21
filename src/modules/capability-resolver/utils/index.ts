import { type DomiaType } from "@/modules/core"
import { getSttEngine } from "@/modules/stt-engine"
import { getLlmEngine } from "@/modules/llm-engine"
import { getTtsEngine } from "@/modules/tts-engine"
import type { StreamingCapabilitiesType, StreamableAdapterType } from "../types"

const engineStreams = (adapter: StreamableAdapterType): boolean =>
	adapter?.capabilities?.streaming === true &&
	typeof adapter?.runStream === "function"

export const resolveDomiaStreamingCapabilities = (
	domia: DomiaType,
): StreamingCapabilitiesType => ({
	stt: engineStreams(
		domia?.sttConfig?.engine ? getSttEngine(domia.sttConfig.engine) : null,
	),
	llm: engineStreams(
		domia?.llmModelConfig?.engine
			? getLlmEngine(domia.llmModelConfig.engine)
			: null,
	),
	tts: engineStreams(
		domia?.ttsConfig?.engine ? getTtsEngine(domia.ttsConfig.engine) : null,
	),
})
