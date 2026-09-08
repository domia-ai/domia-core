export type DiscoveredServiceType = {
	name: string
	host: string
	port: number
	txt: Partial<Record<string, string>>
}

export type DiscoveredSatelliteType = {
	satelliteId: string
	name: string
	host: string
	port: number
}
