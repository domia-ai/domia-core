import type { SpeakResultType } from "@/modules/core-bus"

import type { SpeakWireResultType } from "../types"

export const toSpeakWire = (result: SpeakResultType): SpeakWireResultType => ({
	delivered: result.delivered,
	target: result.target,
	reason: result.reason,
	audioId: result.audioId,
})
