import { DOMIA_TURN_EVENT_ENUM, type DomiaTurnEventType } from "@/buses"
import type { AgUiEventType } from "../types"

export const toAgUiEvent = (
	event: DomiaTurnEventType,
): AgUiEventType | null => {
	const base = { runId: event.interactionId, ts: event.ts }
	switch (event.type) {
		case DOMIA_TURN_EVENT_ENUM.STAGE_STARTED:
			return {
				event: "STEP_STARTED",
				data: { ...base, stepName: event.stageName },
			}
		case DOMIA_TURN_EVENT_ENUM.STAGE_DONE:
			return {
				event: "STEP_FINISHED",
				data: {
					...base,
					stepName: event.stageName,
					elapsedMs: event.elapsedMs,
					status: event.status,
				},
			}
		case DOMIA_TURN_EVENT_ENUM.TOOL_REQUESTED:
			return {
				event: "TOOL_CALL_START",
				data: {
					...base,
					toolCallName: event.toolName,
					provider: event.provider,
				},
			}
		case DOMIA_TURN_EVENT_ENUM.TOOL_RESULT:
			return {
				event: "TOOL_CALL_END",
				data: {
					...base,
					toolCallName: event.toolName,
					status: event.status,
					toolMs: event.toolMs,
				},
			}
		case DOMIA_TURN_EVENT_ENUM.TURN_FAILED:
			return {
				event: "RUN_ERROR",
				data: { ...base, message: event.errorMessage, code: event.errorCode },
			}
		default:
			return null
	}
}
