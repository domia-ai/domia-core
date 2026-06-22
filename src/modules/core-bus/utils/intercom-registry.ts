import { getSatelliteSinkFor } from "./satellite-registry"
import type { StreamingSinkFormatType, IntercomLinkType } from "../types"

const links = new Map<string, IntercomLinkType>()

export const startIntercom = async (
	from: string,
	to: string,
	format: StreamingSinkFormatType,
): Promise<boolean> => {
	if (from === to || links.has(from)) return false
	const sink = getSatelliteSinkFor(to)
	if (!sink) return false
	await sink.begin?.(format)
	links.set(from, { to, sink })
	return true
}

export const getIntercom = (from: string): IntercomLinkType | undefined =>
	links.get(from)

export const stopIntercom = async (from: string): Promise<boolean> => {
	const link = links.get(from)
	if (!link) return false
	links.delete(from)
	await link.sink.end?.()
	return true
}

export const stopIntercomTo = async (to: string): Promise<void> => {
	for (const [from, link] of [...links.entries()]) {
		if (link.to !== to) continue
		links.delete(from)
		await link.sink.end?.()
	}
}
