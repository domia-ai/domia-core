import { env } from "@/config"

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])

export const isLoopbackAddress = (address: string | undefined): boolean =>
	address !== undefined && LOOPBACK_ADDRESSES.has(address)

export const isValidMeshBearer = (header: string | undefined): boolean =>
	header === `Bearer ${env.DOMIA_MESH_SECRET}`

export const isValidMeshToken = (token: string | undefined): boolean =>
	token === env.DOMIA_MESH_SECRET

export const meshBearerHeader = (): Record<string, string> => ({
	authorization: `Bearer ${env.DOMIA_MESH_SECRET}`,
})
