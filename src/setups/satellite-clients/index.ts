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

import type { SatelliteHandleType } from "./types"

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
						followUpNoSpeechMs: row.followUpNoSpeechMs,
						playbackDrainMarginMs: row.playbackDrainMarginMs,
						runListeningMaxMs: row.runListeningMaxMs,
						followUpRequestMaxMs: row.followUpRequestMaxMs,
						captureHeadTrimMs: row.captureHeadTrimMs,
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
			case SATELLITE_PROTOCOL_ENUM.LIVEKIT: {
				if (!row.livekitApiKey || !row.livekitApiSecret) {
					satelliteGatewayLogger.warn(
						"livekit satellite missing api key/secret — skipped",
						{ satelliteId: row.satelliteId },
					)
					break
				}

				try {
					const { connectLivekitSatellite } =
						await import("@/modules/satellite-protocols/livekit")
					close = connectLivekitSatellite(
						{
							satelliteId: row.satelliteId,
							name: row.name,
							url: `ws://${row.host}:${row.port}`,
							apiKey: row.livekitApiKey,
							apiSecret: row.livekitApiSecret,
							roomName: row.livekitRoom ?? row.satelliteId,
						},
						fallback,
						row.domia.domiaKey,
					).close
				} catch (err) {
					satelliteGatewayLogger.warn(
						"livekit runtime unavailable on this platform — satellite skipped",
						{ satelliteId: row.satelliteId, err },
					)
				}
				break
			}
			case SATELLITE_PROTOCOL_ENUM.NATIVE:
			case SATELLITE_PROTOCOL_ENUM.OPENAI_REALTIME:
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
