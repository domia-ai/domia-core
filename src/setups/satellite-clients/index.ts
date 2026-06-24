import {
	type DomiaType,
	getActiveSatellites,
	isHostedIdentity,
} from "@/modules/core"
import { satelliteGatewayLogger } from "@/utils"
import { connectEsphomeSatellite } from "@/modules/satellite-protocols/esphome"
import { connectWyomingSatellite } from "@/modules/satellite-protocols/wyoming"
import { SATELLITE_PROTOCOL_ENUM } from "@/db"

export const setupSatelliteClients = async ({
	fallback,
}: {
	fallback: DomiaType
}): Promise<void> => {
	const rows = await getActiveSatellites()
	const bindings = rows.filter(
		(row) => row.domia.isActive && isHostedIdentity(row.domia.domiaKey),
	)
	if (bindings.length === 0) return

	const handles: { close: () => void }[] = []
	for (const row of bindings) {
		switch (row.protocol) {
			case SATELLITE_PROTOCOL_ENUM.ESPHOME:
				handles.push(
					connectEsphomeSatellite(
						{
							satelliteId: row.satelliteId,
							name: row.name,
							host: row.host,
							port: row.port,
							encryptionKey: row.encryptionKey,
							desiredWakeWords: row.desiredWakeWords ?? [],
							desiredNumbers: row.desiredNumbers ?? {},
							followUpEnabled: row.followUpEnabled ?? false,
						},
						fallback,
						row.domia.domiaKey,
					),
				)
				break
			case SATELLITE_PROTOCOL_ENUM.WYOMING:
				handles.push(
					connectWyomingSatellite(
						`${row.host}:${row.port}`,
						fallback,
						row.domia.domiaKey,
						row.satelliteId,
					),
				)
				break
			case SATELLITE_PROTOCOL_ENUM.NATIVE:
				break
			default:
				satelliteGatewayLogger.warn("unknown satellite protocol — skipped", {
					satelliteId: row.satelliteId,
					protocol: row.protocol,
				})
		}
	}

	satelliteGatewayLogger.success(
		`🛰️ satellite clients → ${handles.length} connected`,
	)

	const cleanup = (): void => {
		for (const handle of handles) handle.close()
	}
	process.once("SIGINT", cleanup)
	process.once("SIGTERM", cleanup)
	process.once("exit", cleanup)
}
