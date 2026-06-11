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
	stt:
		domia?.runtimeCapabilities?.stt === true &&
		engineStreams(
			domia?.sttConfig?.engine ? getSttEngine(domia.sttConfig.engine) : null,
		),
	llm:
		domia?.runtimeCapabilities?.llm === true &&
		engineStreams(
			domia?.llmModelConfig?.engine
				? getLlmEngine(domia.llmModelConfig.engine)
				: null,
		),
	tts:
		domia?.runtimeCapabilities?.tts === true &&
		engineStreams(
			domia?.ttsConfig?.engine ? getTtsEngine(domia.ttsConfig.engine) : null,
		),
})
