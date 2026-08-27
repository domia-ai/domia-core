import { EventEmitter } from "events"

import type { FakeEsphomeCallType, FakeEsphomeDeviceType } from "../types"

export const createFakeEsphomeDevice = (): FakeEsphomeDeviceType => {
	const calls: FakeEsphomeCallType[] = []
	let entities: Record<string, unknown>[] = []
	const instances: EventEmitter[] = []
	const rec =
		(method: string) =>
		(...args: unknown[]) => {
			calls.push({ method, args })
		}

	// class required: the adapter constructs the client with `new module.EspHomeClient(...)`
	class FakeEspHomeClient extends EventEmitter {
		connect = () => {
			setTimeout(() => this.emit("connect"), 2)
		}
		disconnect = (...args: unknown[]) => {
			calls.push({ method: "disconnect", args })
			setTimeout(() => this.emit("disconnect", "fake-disconnect"), 2)
		}
		subscribeVoiceAssistant = rec("subscribeVoiceAssistant")
		requestVoiceAssistantConfiguration = rec(
			"requestVoiceAssistantConfiguration",
		)
		setVoiceAssistantConfiguration = rec("setVoiceAssistantConfiguration")
		sendVoiceAssistantEvent = rec("sendVoiceAssistantEvent")
		sendVoiceAssistantResponse = rec("sendVoiceAssistantResponse")
		sendVoiceAssistantAnnounce = rec("sendVoiceAssistantAnnounce")
		sendVoiceAssistantTimerEvent = rec("sendVoiceAssistantTimerEvent")
		sendNumberCommand = rec("sendNumberCommand")
		sendMediaPlayerCommand = rec("sendMediaPlayerCommand")
		getEntitiesWithIds = () => entities
		constructor() {
			super()
			instances.push(this)
		}
	}

	const esphomeModule = {
		EspHomeClient: FakeEspHomeClient,
		VoiceAssistantSubscribeFlag: { API_AUDIO: 1 },
		VoiceAssistantEvent: {
			ERROR: 0,
			RUN_START: 1,
			RUN_END: 2,
			STT_START: 3,
			STT_END: 4,
			STT_VAD_END: 5,
			INTENT_START: 6,
			INTENT_END: 7,
			TTS_START: 8,
			TTS_END: 9,
		},
		VoiceAssistantTimerEvent: {
			STARTED: 0,
			UPDATED: 1,
			CANCELLED: 2,
			FINISHED: 3,
		},
		MediaPlayerCommand: { STOP: 0, PAUSE: 1, PLAY: 2 },
	}

	return {
		module: esphomeModule as unknown as FakeEsphomeDeviceType["module"],
		calls,
		callsOf: (method: string) => calls.filter((c) => c.method === method),
		sentEventTypes: () =>
			calls
				.filter((c) => c.method === "sendVoiceAssistantEvent")
				.map((c) => c.args[0] as number),
		emit: (name: string, payload?: unknown) => {
			instances[instances.length - 1]?.emit(name, payload)
		},
		setEntities: (list: Record<string, unknown>[]) => {
			entities = list
		},
	}
}
