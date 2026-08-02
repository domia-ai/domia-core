export enum DOMIA_TURN_EVENT_ENUM {
	TURN_STARTED = "turn.started",
	ENDPOINT_ACCEPTED = "endpoint.accepted",
	STT_FINAL = "stt.final",
	STAGE_STARTED = "stage.started",
	STAGE_DONE = "stage.done",
	INTENT_DECIDED = "intent.decided",
	LLM_FIRST_SENTENCE = "llm.first_sentence",
	LLM_DONE = "llm.done",
	TOOL_REQUESTED = "tool.requested",
	TOOL_RESULT = "tool.result",
	TTS_FIRST_AUDIO = "tts.first_audio",
	PLAYBACK_STARTED = "playback.started",
	PLAYBACK_FINISHED = "playback.finished",
	TURN_COMPLETED = "turn.completed",
	TURN_FAILED = "turn.failed",
	TURN_ABORTED = "turn.aborted",
	SPECULATION_STARTED = "speculation.started",
	SPECULATION_COMMITTED = "speculation.committed",
	SPECULATION_DISCARDED = "speculation.discarded",
}

export const TURN_EVENT_SEQ_LRU_MAX = 256
