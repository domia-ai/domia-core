import { spawn } from "node:child_process"
import { platform } from "node:os"

import { Bonjour, type Service } from "bonjour-service"

import { DEFAULT_ESPHOME_DISCOVERY_MS } from "@/db"
import { satelliteDiscoveryLogger as logger } from "@/utils"

import type { DiscoveredSatelliteType } from "../types"

const ESPHOME_SERVICE_TYPE = "esphomelib"
const ESPHOME_SERVICE = `_${ESPHOME_SERVICE_TYPE}._tcp`

const stripDot = (value: string): string => value.replace(/\.$/, "")

const pickHost = (service: Service): string => {
	const ipv4 = service.addresses?.find(
		(a) => a.includes(".") && !a.includes(":"),
	)
	return ipv4 ?? service.host
}

const runFor = (cmd: string, cmdArgs: string[], ms: number): Promise<string> =>
	new Promise((resolve) => {
		const child = spawn(cmd, cmdArgs)
		let out = ""
		child.stdout.on("data", (chunk) => {
			out += chunk.toString()
		})
		child.on("error", () => resolve(out))
		const timer = setTimeout(() => {
			child.kill()
			resolve(out)
		}, ms)
		child.on("close", () => {
			clearTimeout(timer)
			resolve(out)
		})
	})

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

const resolveViaDnsSd = async (
	name: string,
	ms: number,
): Promise<DiscoveredSatelliteType | null> => {
	const out = await runFor("dns-sd", ["-L", name, ESPHOME_SERVICE], ms)
	const match = out.match(/can be reached at\s+([^\s:]+):(\d+)/)
	if (!match) return null
	const port = Number(match[2])
	if (!Number.isFinite(port) || port <= 0) return null
	return { satelliteId: name, name, host: stripDot(match[1]), port }
}

const discoverViaDnsSd = async (
	timeoutMs: number,
): Promise<DiscoveredSatelliteType[]> => {
	const browseMs = Math.max(1500, Math.floor(timeoutMs * 0.5))
	const resolveMs = Math.max(1500, timeoutMs - browseMs)
	const names = parseBrowseNames(
		await runFor("dns-sd", ["-B", ESPHOME_SERVICE], browseMs),
	)
	const resolved = await Promise.all(
		names.map((name) => resolveViaDnsSd(name, resolveMs)),
	)
	return resolved.filter((s): s is DiscoveredSatelliteType => s !== null)
}

const discoverViaBonjour = (
	timeoutMs: number,
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

export const discoverEsphome = async (
	timeoutMs: number = DEFAULT_ESPHOME_DISCOVERY_MS,
): Promise<DiscoveredSatelliteType[]> => {
	if (platform() === "darwin") {
		const viaDnsSd = await discoverViaDnsSd(timeoutMs).catch(() => [])
		if (viaDnsSd.length > 0) return viaDnsSd
	}
	return discoverViaBonjour(timeoutMs)
}
