import {
	type DomiaType,
	getActiveSatellites,
	isHostedIdentity,
} from "@/modules/core"
import { satelliteGatewayLogger } from "@/utils"
import { registerShutdownTask } from "@/setups/shutdown"
import { connectEsphomeSatellite } from "@/modules/satellite-protocols/esphome"
import { connectWyomingSatellite } from "@/modules/satellite-protocols/wyoming"
import { SATELLITE_PROTOCOL_ENUM } from "@/db"

type SatelliteHandleType = { close: () => void; domiaId: string }

const satelliteHandles = new Map<string, SatelliteHandleType>()

const connectBindings = async (
	fallback: DomiaType,
	filter?: (domiaId: string) => boolean,
): Promise<void> => {
	const rows = await getActiveSatellites()
	const bindings = rows.filter(
		(row) =>
			row.domia.isActive &&
			isHostedIdentity(row.domia.domiaKey) &&
			(!filter || filter(row.domiaId)),
	)
	for (const row of bindings) {
		let close: (() => void) | null = null
		switch (row.protocol) {
			case SATELLITE_PROTOCOL_ENUM.ESPHOME:
				close = connectEsphomeSatellite(
					{
						satelliteId: row.satelliteId,
						name: row.name,
						host: row.host,
						port: row.port,
						encryptionKey: row.encryptionKey,
						desiredWakeWords: row.desiredWakeWords ?? [],
						desiredNumbers: row.desiredNumbers ?? {},
						desiredVolume: row.desiredVolume ?? null,
						followUpEnabled: row.followUpEnabled ?? false,
					},
					fallback,
					row.domia.domiaKey,
				).close
				break
			case SATELLITE_PROTOCOL_ENUM.WYOMING:
				close = connectWyomingSatellite(
					`${row.host}:${row.port}`,
					fallback,
					row.domia.domiaKey,
					row.satelliteId,
				).close
				break
			case SATELLITE_PROTOCOL_ENUM.NATIVE:
				break
			default:
				satelliteGatewayLogger.warn("unknown satellite protocol — skipped", {
					satelliteId: row.satelliteId,
					protocol: row.protocol,
				})
		}
		if (close)
			satelliteHandles.set(row.satelliteId, { close, domiaId: row.domiaId })
	}
	satelliteGatewayLogger.success(
		`🛰️ satellite clients → ${satelliteHandles.size} connected`,
	)
}

const closeSatellites = (filter?: (domiaId: string) => boolean): void => {
	for (const [satelliteId, handle] of satelliteHandles) {
		if (filter && !filter(handle.domiaId)) continue
		handle.close()
		satelliteHandles.delete(satelliteId)
	}
}

export const setupSatelliteClients = async ({
	fallback,
}: {
	fallback: DomiaType
}): Promise<void> => {
	await connectBindings(fallback)
	const closeAll = (): void => closeSatellites()
	registerShutdownTask("satellite-clients", closeAll)
	process.once("exit", closeAll)
}

export const reloadSatelliteClientsForDomia = async (
	domia: DomiaType,
): Promise<void> => {
	const sameDomia = (domiaId: string): boolean => domiaId === domia.id
	closeSatellites(sameDomia)
	await connectBindings(domia, sameDomia)
}
