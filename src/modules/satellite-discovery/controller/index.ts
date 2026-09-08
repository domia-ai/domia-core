import { platform } from "node:os"

import { Bonjour, type Service } from "bonjour-service"

import { DEFAULT_ESPHOME_DISCOVERY_MS } from "@/db"
import { satelliteDiscoveryLogger as logger, runProcess } from "@/utils"

import type { DiscoveredSatelliteType, DiscoveredServiceType } from "../types"

const ESPHOME_SERVICE_TYPE = "esphomelib"
const serviceOf = (serviceType: string): string => `_${serviceType}._tcp`

const stripDot = (value: string): string => value.replace(/\.$/, "")

const pickHost = (service: Service): string => {
	const ipv4 = service.addresses?.find(
		(a) => a.includes(".") && !a.includes(":"),
	)
	return ipv4 ?? service.host
}

const runFor = async (
	cmd: string,
	cmdArgs: string[],
	ms: number,
): Promise<string> => (await runProcess(cmd, cmdArgs, { timeoutMs: ms })).stdout

const parseBrowseNames = (browseOut: string): string[] => [
	...new Set(
		browseOut
			.split("\n")
			.map((line) => line.trim().split(/\s+/))
			.filter((cols) => cols[1] === "Add")
			.map((cols) => cols.slice(6).join(" ").trim())
			.filter((name) => name.length > 0),
	),
]

const parseTxt = (out: string): Partial<Record<string, string>> => {
	const txt: Partial<Record<string, string>> = {}
	const line = out
		.split("\n")
		.map((l) => l.trim())
		.find((l) => /^\w+=/.test(l))
	if (!line) return txt
	for (const match of line.matchAll(/(\w+)=((?:\\.|[^\s\\])*)/g))
		txt[match[1]] = match[2].replace(/\\(.)/g, "$1")
	return txt
}

const resolveViaDnsSd = async (
	name: string,
	serviceType: string,
	ms: number,
): Promise<DiscoveredServiceType | null> => {
	const out = await runFor("dns-sd", ["-L", name, serviceOf(serviceType)], ms)
	const match = /can be reached at\s+([^\s:]+):(\d+)/.exec(out)
	if (!match) return null
	const port = Number(match[2])
	if (!Number.isFinite(port) || port <= 0) return null
	return { name, host: stripDot(match[1]), port, txt: parseTxt(out) }
}

const discoverViaDnsSd = async (
	serviceType: string,
	timeoutMs: number,
): Promise<DiscoveredServiceType[]> => {
	const browseMs = Math.max(1500, Math.floor(timeoutMs * 0.5))
	const resolveMs = Math.max(1500, timeoutMs - browseMs)
	const names = parseBrowseNames(
		await runFor("dns-sd", ["-B", serviceOf(serviceType)], browseMs),
	)
	const resolved = await Promise.all(
		names.map((name) => resolveViaDnsSd(name, serviceType, resolveMs)),
	)
	return resolved.filter((s): s is DiscoveredServiceType => s !== null)
}

const txtOf = (service: Service): Partial<Record<string, string>> => {
	const raw = service.txt as Record<string, unknown> | undefined
	const txt: Partial<Record<string, string>> = {}
	for (const [k, v] of Object.entries(raw ?? {}))
		if (typeof v === "string") txt[k] = v
	return txt
}

const discoverViaBonjour = (
	serviceType: string,
	timeoutMs: number,
): Promise<DiscoveredServiceType[]> =>
	new Promise((resolve) => {
		const found = new Map<string, DiscoveredServiceType>()
		const bonjour = new Bonjour()
		const browser = bonjour.find(
			{ type: serviceType, protocol: "tcp" },
			(service) => {
				const host = pickHost(service)
				if (!host || !service.port || service.port <= 0) return
				found.set(service.name, {
					name: service.name,
					host,
					port: service.port,
					txt: txtOf(service),
				})
			},
		)

		const requery = setInterval(() => browser.update(), 1000)

		const finish = () => {
			clearInterval(requery)
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

export const browseService = async (
	serviceType: string,
	timeoutMs: number,
): Promise<DiscoveredServiceType[]> => {
	if (platform() === "darwin") {
		const viaDnsSd = await discoverViaDnsSd(serviceType, timeoutMs).catch(
			() => [],
		)
		if (viaDnsSd.length > 0) return viaDnsSd
	}
	return discoverViaBonjour(serviceType, timeoutMs)
}

export const discoverEsphome = async (
	timeoutMs: number = DEFAULT_ESPHOME_DISCOVERY_MS,
): Promise<DiscoveredSatelliteType[]> =>
	(await browseService(ESPHOME_SERVICE_TYPE, timeoutMs)).map((service) => ({
		satelliteId: service.name,
		name: service.txt.friendly_name ?? service.name,
		host: service.host,
		port: service.port,
	}))
