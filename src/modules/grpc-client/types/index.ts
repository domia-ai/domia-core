import type { ResolvedDelegateType } from "@/modules/capability-resolver"
import type {
	AudioReadyPayload,
	SttDonePayload,
	LlmDonePayload,
	TtsDonePayload,
} from "@/generated/proto/domia"

export type DeliverEventTarget = ResolvedDelegateType

export type DeliverEventPayloadMap = {
	audioReady: AudioReadyPayload
	sttDone: SttDonePayload
	llmDone: LlmDonePayload
	ttsDone: TtsDonePayload
}

export type DeliverEventResult = {
	delivered: boolean
	deduplicated: boolean
	target?: DeliverEventTarget
	error?: string
	attemptedTargets: number
}
