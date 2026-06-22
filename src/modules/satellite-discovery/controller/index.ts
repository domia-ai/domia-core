import { Bonjour, type Service } from "bonjour-service"

import { DEFAULT_ESPHOME_DISCOVERY_MS } from "@/db"
import { satelliteDiscoveryLogger as logger } from "@/utils"

import type { DiscoveredSatelliteType } from "../types"

const ESPHOME_SERVICE_TYPE = "esphomelib"

const pickHost = (service: Service): string => {
	const ipv4 = service.addresses?.find(
		(a) => a.includes(".") && !a.includes(":"),
	)
	return ipv4 ?? service.host
}

export const discoverEsphome = (
	timeoutMs: number = DEFAULT_ESPHOME_DISCOVERY_MS,
): Promise<DiscoveredSatelliteType[]> =>
	new Promise((resolve) => {
		const found = new Map<string, DiscoveredSatelliteType>()
		const bonjour = new Bonjour()
		const browser = bonjour.find(
			{ type: ESPHOME_SERVICE_TYPE, protocol: "tcp" },
			(service) => {
				const host = pickHost(service)
				if (!host || !service.port || service.port <= 0) return
				found.set(service.name, {
					satelliteId: service.name,
					name: String(service.txt?.friendly_name ?? service.name),
					host,
					port: service.port,
				})
			},
		)

		const finish = () => {
			clearTimeout(timer)
			try {
				browser.stop()
				bonjour.destroy()
			} catch (err) {
				logger.warn("discovery cleanup failed", {
					error: err instanceof Error ? err.message : String(err),
				})
			}
			resolve([...found.values()])
		}

		const timer = setTimeout(finish, timeoutMs)
	})
