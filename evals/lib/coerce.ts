import type { RawData } from "ws"

export const rawDataToString = (data: RawData): string => {
	if (Buffer.isBuffer(data)) return data.toString("utf8")
	if (Array.isArray(data)) return Buffer.concat(data).toString("utf8")
	return Buffer.from(data).toString("utf8")
}

export const stringOrEmpty = (value: unknown): string =>
	typeof value === "string" ? value : ""
