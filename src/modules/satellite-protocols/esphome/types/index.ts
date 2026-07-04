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
}

export type EsphomeSatelliteHandleType = {
	close: () => void
}
