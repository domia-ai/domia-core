export enum DOMIA_EVENT_BUS_ENUM {
	WAKE_DETECTED = "wake_detected",
	AUDIO_READY = "audio_ready",
	STT_DONE = "stt_done",
	PROCESSING_STARTED = "processing_started",
	LLM_DONE = "llm_done",
	TTS_DONE = "tts_done",
	PLAYBACK_STARTED = "playback_started",
	PLAYBACK_FINISHED = "playback_finished",
	AUDIO_ERROR = "audio_error",
	CAPABILITY_MISSING = "capability_missing",
	INTERACTION_FAILED = "interaction_failed",
}
