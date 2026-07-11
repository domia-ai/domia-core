import diagnosticsChannel from "diagnostics_channel"

import type { DomiaTurnEventType } from "./types"

export const TURN_EVENT_DIAGNOSTICS_CHANNEL = "domia:turn-event"

const channel = diagnosticsChannel.channel(TURN_EVENT_DIAGNOSTICS_CHANNEL)

export const publishTurnEventDiagnostics = (
	event: DomiaTurnEventType,
): void => {
	if (channel.hasSubscribers) channel.publish(event)
}
