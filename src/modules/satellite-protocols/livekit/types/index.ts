import type { AudioSource, LocalTrackPublication } from "@livekit/rtc-node"

import type { StreamingSinkFormatType } from "@/modules/core-bus"

export type LivekitSatelliteConfigType = {
	satelliteId: string
	name: string | null
	url: string
	apiKey: string
	apiSecret: string
	roomName: string
}

export type LivekitSatelliteHandleType = {
	close: () => void
}

export type LivekitOutputStateType = {
	source: AudioSource
	format: StreamingSinkFormatType
	ready: Promise<LocalTrackPublication>
}
