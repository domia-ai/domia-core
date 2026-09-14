import { LLM_ENGINE_ENUM } from "@/db"

import type { LlmEngineAdapterType } from "../../types"
import {
	prefillOpenAiCompatible,
	runOpenAiCompatible,
	runOpenAiCompatibleStream,
	warmupOpenAiCompatible,
} from "./runners"
import {
	runOpenAiCompatibleChatConstrainedJson,
	runOpenAiCompatibleConstrainedJson,
	runOpenAiCompatibleIntent,
	runOpenAiCompatibleJson,
} from "./structured"
import {
	runOpenAiCompatibleReplyStreamOrTools,
	runOpenAiCompatibleWithTools,
} from "./tools"

export const openAiCompatibleEngine: LlmEngineAdapterType = {
	id: LLM_ENGINE_ENUM.OPENAI_COMPATIBLE,
	capabilities: { streaming: true, tools: true },
	run: runOpenAiCompatible,
	runStream: runOpenAiCompatibleStream,
	runJson: runOpenAiCompatibleJson,
	runWithTools: runOpenAiCompatibleWithTools,
	runReplyStreamOrTools: runOpenAiCompatibleReplyStreamOrTools,
	runConstrainedJson: runOpenAiCompatibleConstrainedJson,
	runChatConstrainedJson: runOpenAiCompatibleChatConstrainedJson,
	runIntent: runOpenAiCompatibleIntent,
	warmup: warmupOpenAiCompatible,
	prefill: prefillOpenAiCompatible,
}
