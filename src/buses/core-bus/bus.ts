import { EventEmitter } from "events"

import { DOMIA_EVENT_BUS_ENUM } from "./constants"
import { DomiaEventBusPayloadMapType } from "./types"
import { domiaBusLogger } from "@/utils"

export const domiaBus = new EventEmitter()

export const publishToDomiaBus = <E extends DOMIA_EVENT_BUS_ENUM>(
	domiaId: string,
	event: E,
	payload?: DomiaEventBusPayloadMapType[E],
) => {
	domiaBusLogger.info(`Emitting event ${event} for domia ${domiaId}`, {
		payload,
	})
	domiaBus.emit(`${event}:${domiaId}`, payload)
}

export const subscribeToDomiaBus = <E extends DOMIA_EVENT_BUS_ENUM>(
	domiaId: string,
	event: E,
	handler: (payload: DomiaEventBusPayloadMapType[E]) => void,
) => {
	domiaBusLogger.info(`Adding listener for event ${event} on domia ${domiaId}`)
	domiaBus.on(`${event}:${domiaId}`, handler)
}

export const subscribeToDomiaBusOnce = <E extends DOMIA_EVENT_BUS_ENUM>(
	domiaId: string,
	event: E,
	handler: (payload: DomiaEventBusPayloadMapType[E]) => void,
) => {
	domiaBusLogger.info(
		`Adding one-time listener for event ${event} on domia ${domiaId}`,
	)
	domiaBus.once(`${event}:${domiaId}`, handler)
}

export const unsubscribeFromDomiaBus = <E extends DOMIA_EVENT_BUS_ENUM>(
	domiaId: string,
	event: E,
	handler: (payload: DomiaEventBusPayloadMapType[E]) => void,
) => {
	domiaBusLogger.info(
		`Removing listener for event ${event} from domia ${domiaId}`,
	)
	domiaBus.off(`${event}:${domiaId}`, handler)
}

export const clearDomiaBusSubscribers = <E extends DOMIA_EVENT_BUS_ENUM>(
	domiaId: string,
	event: E,
) => {
	domiaBusLogger.info(
		`Clearing all listeners for event ${event} from domia ${domiaId}`,
	)
	domiaBus.removeAllListeners(`${event}:${domiaId}`)
}
