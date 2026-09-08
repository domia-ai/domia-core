import { hasActivePlayback } from "@/modules/audio-playback"
import {
	activeVoiceReplies,
	queuedVoiceReplies,
} from "@/modules/voice-admission"
import { getActiveTurn } from "./turn-scope"
import { isRecordingInProgress } from "./recording-guard"
import { isPresenceListening } from "./presence-registry"

export const isDomiaBusy = (domiaId: string, domiaKey?: string): boolean =>
	getActiveTurn(domiaId) !== null ||
	activeVoiceReplies(domiaId) > 0 ||
	queuedVoiceReplies(domiaId) > 0 ||
	hasActivePlayback(domiaId) ||
	isRecordingInProgress(domiaId) ||
	(domiaKey !== undefined && isPresenceListening(domiaKey))
