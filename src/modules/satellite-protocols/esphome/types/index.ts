import type { Entity } from "esphome-client"

export type EsphomeModuleType = typeof import("esphome-client")

export type NumberEntityInfoType = Extract<Entity, { type: "number" }> & {
	id: string
}

export type EsphomeBindingType = {
	satelliteId: string
	name: string | null
	host: string
	port: number
	encryptionKey: string | null
	desiredWakeWords?: string[]
	desiredNumbers?: Record<string, number>
	desiredVolume?: number | null
	followUpEnabled?: boolean
	followUpNoSpeechMs?: number
	playbackDrainMarginMs?: number
	runListeningMaxMs?: number
	followUpRequestMaxMs?: number
	captureHeadTrimMs?: number
}

export type RunPhaseType =
	| "idle"
	| "listening"
	| "processing"
	| "playback"
	| "expect_followup"

export type PlaybackKindType = "reply" | "announce"

export type PlaybackItemType = {
	url: string
	kind: PlaybackKindType
	followUp: boolean
	durationMs: number | null
	runGeneration: number | null
	playbackGeneration: number
	enqueuedAt: number
	startedAt?: number
	expiresAt: number
}

export type RunControllerDepsType = {
	satelliteId: string
	sendEvent: (type: number, data?: { name: string; value: string }[]) => void
	respondToRequest: (error: boolean) => void
	sendAnnounce: (url: string, startConversation: boolean) => void
	stopMedia: () => boolean
	events: {
		runStart: number
		runEnd: number
		sttVadEnd: number
		error: number
		sttStart: number
		intentStart: number
		intentEnd: number
		ttsStart: number
		ttsEnd: number
		sttEnd: number
	}
	budgets: {
		listeningMaxMs: number
		followUpNoSpeechMs: number
		drainMarginMs: number
		followUpRequestMaxMs: number
		processingMaxMs: number
	}
	onRunAccepted: (
		followUpRun: boolean,
		minListenMs: number,
		muteMs: number,
	) => void
	onRunCancelled: (reason: string) => void
	hasPendingSpeech?: () => boolean
	onRunClosed: () => void
	onPlaybackStart: (durationMs: number | null) => void
	onPlaybackDurationKnown?: (durationMs: number) => void
	onPlaybackEnd: () => void
}

export type RunControllerType = {
	onRequest: (start: boolean) => void
	onTranscript: (text: string) => void
	notifySpeechEnd: () => void
	enqueuePlayback: (
		url: string,
		kind: PlaybackKindType,
		followUp: boolean,
		durationMs: number | null,
		runToken?: number | null,
	) => number | null
	updatePlaybackDuration: (
		generation: number,
		durationMs: number | null,
	) => void
	onMediaState: (state: number) => void
	onAnnounceFinished: () => void
	finishTurn: () => void
	isFollowUpRun: () => boolean
	currentGeneration: () => number
	dispose: () => void
}

export type EsphomeSatelliteHandleType = {
	close: () => void
}
