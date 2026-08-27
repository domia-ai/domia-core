import { randomUUID } from "crypto"

import { eq } from "drizzle-orm"

import { dbClient, domia, satelliteConfig } from "@/db"
import { upsertDomiaFromNetwork } from "@/modules/network-sync"
import { upsertSatellite } from "@/modules/core"
import { type DomiaType } from "@/modules/core"

const PEER_KEY = "eval-d8-peer"
const SATELLITE_ID = "eval-d8-vpe"

const peerPayload = (id: string): DomiaType =>
	({ id, name: "eval-d8", domiaKey: PEER_KEY }) as DomiaType

const readSatellite = () =>
	dbClient
		.select()
		.from(satelliteConfig)
		.where(eq(satelliteConfig.satelliteId, SATELLITE_ID))
		.get()

const cleanup = (): void => {
	dbClient
		.delete(satelliteConfig)
		.where(eq(satelliteConfig.satelliteId, SATELLITE_ID))
		.run()
	dbClient.delete(domia).where(eq(domia.domiaKey, PEER_KEY)).run()
}

const main = async (): Promise<void> => {
	cleanup()
	const firstId = randomUUID()
	const secondId = randomUUID()

	await upsertDomiaFromNetwork(peerPayload(firstId))
	await upsertSatellite(firstId, {
		id: randomUUID(),
		satelliteId: SATELLITE_ID,
		name: "eval VPE",
		host: "192.168.0.19",
		port: 6053,
		encryptionKey: null,
		protocol: "esphome",
		livekitApiKey: null,
		livekitApiSecret: null,
		livekitRoom: null,
	})
	dbClient
		.update(satelliteConfig)
		.set({ followUpEnabled: true, captureHeadTrimMs: 300 })
		.where(eq(satelliteConfig.satelliteId, SATELLITE_ID))
		.run()

	await upsertSatellite(firstId, {
		id: randomUUID(),
		satelliteId: SATELLITE_ID,
		name: "eval VPE",
		host: "192.168.0.9",
		port: 6053,
		encryptionKey: null,
		protocol: "esphome",
		livekitApiKey: null,
		livekitApiSecret: null,
		livekitRoom: null,
	})
	const afterRebind = readSatellite()

	await upsertDomiaFromNetwork(peerPayload(secondId))
	const afterReRegistration = readSatellite()

	const checks: [string, boolean, string][] = [
		[
			"host-change re-bind keeps flags",
			afterRebind?.followUpEnabled === true &&
				afterRebind?.captureHeadTrimMs === 300 &&
				afterRebind?.host === "192.168.0.9",
			`followUp=${afterRebind?.followUpEnabled} trim=${afterRebind?.captureHeadTrimMs} host=${afterRebind?.host}`,
		],
		[
			"peer re-registration keeps the satellite row",
			afterReRegistration !== undefined,
			afterReRegistration ? "row present" : "row DELETED",
		],
		[
			"peer re-registration re-parents to the new peer id",
			afterReRegistration?.domiaId === secondId,
			`domiaId=${afterReRegistration?.domiaId?.slice(0, 8)} expected=${secondId.slice(0, 8)}`,
		],
		[
			"peer re-registration keeps flags",
			afterReRegistration?.followUpEnabled === true &&
				afterReRegistration?.captureHeadTrimMs === 300,
			`followUp=${afterReRegistration?.followUpEnabled} trim=${afterReRegistration?.captureHeadTrimMs}`,
		],
	]

	cleanup()

	let failed = 0
	for (const [name, ok, detail] of checks) {
		console.log(`${ok ? "✅" : "❌"} ${name} (${detail})`)
		if (!ok) failed++
	}
	console.log(
		`${checks.length - failed}/${checks.length} satellite-persistence checks passed`,
	)
	if (failed) process.exit(1)
}

void main()
