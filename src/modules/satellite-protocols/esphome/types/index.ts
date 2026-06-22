export type EsphomeModuleType = typeof import("esphome-client")

export type EsphomeBindingType = {
	satelliteId: string
	name: string | null
	host: string
	port: number
	encryptionKey: string | null
}

export type EsphomeSatelliteHandleType = {
	close: () => void
}
