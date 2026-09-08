import { readFileSync } from "fs"
import { resolve } from "path"
import type { ServerOptions as HttpsServerOptions } from "https"

import { ChannelCredentials, ServerCredentials } from "@grpc/grpc-js"

import { env } from "@/config"
import { domiaError, CORE_ERRORS } from "../error"
import { tlsLogger } from "../logger"
import type { HttpSchemeType, TlsMaterialType } from "./types"

let cached: TlsMaterialType | null | undefined

const readMaterialFile = (label: string, file: string): Buffer => {
	try {
		return readFileSync(resolve(file))
	} catch (err) {
		throw domiaError(CORE_ERRORS.TLS_MATERIAL_UNREADABLE, {
			logger: tlsLogger,
			meta: {
				label,
				file,
				err: err instanceof Error ? err.message : String(err),
			},
		})
	}
}

export const loadTlsMaterial = (): TlsMaterialType | null => {
	if (cached !== undefined) return cached
	const certFile = env.DOMIA_TLS_CERT_FILE
	const keyFile = env.DOMIA_TLS_KEY_FILE
	if (!certFile || !keyFile) {
		if (certFile || keyFile)
			tlsLogger.warn(
				"⚠️ DOMIA_TLS_CERT_FILE and DOMIA_TLS_KEY_FILE must both be set — TLS stays off",
			)
		cached = null
		return cached
	}
	const caFile = env.DOMIA_TLS_CA_FILE ?? null
	cached = {
		cert: readMaterialFile("cert", certFile),
		key: readMaterialFile("key", keyFile),
		ca: caFile ? readMaterialFile("ca", caFile) : null,
		requireClientCert: env.DOMIA_TLS_REQUIRE_CLIENT_CERT,
		certFile,
		keyFile,
		caFile,
	}
	tlsLogger.info(
		`🔐 TLS material loaded (cert=${certFile}, ca=${caFile ?? "system"}, clientAuth=${cached.requireClientCert})`,
	)
	return cached
}

export const isTlsEnabled = (): boolean => loadTlsMaterial() !== null

export const httpScheme = (): HttpSchemeType =>
	isTlsEnabled() ? "https" : "http"

export const httpsServerOptions = (): HttpsServerOptions | null => {
	const material = loadTlsMaterial()
	if (!material) return null
	return {
		cert: material.cert,
		key: material.key,
		...(material.ca ? { ca: material.ca } : {}),
		requestCert: material.requireClientCert,
		rejectUnauthorized: material.requireClientCert,
	}
}

export const grpcServerCredentials = (): ServerCredentials => {
	const material = loadTlsMaterial()
	if (!material) return ServerCredentials.createInsecure()
	return ServerCredentials.createSsl(
		material.ca,
		[{ private_key: material.key, cert_chain: material.cert }],
		material.requireClientCert,
	)
}

export const grpcChannelCredentials = (
	peerTls: boolean,
): ChannelCredentials => {
	if (!peerTls) return ChannelCredentials.createInsecure()
	const material = loadTlsMaterial()
	const ca = material?.ca ?? null
	return ChannelCredentials.createSsl(
		ca,
		material?.key ?? null,
		material?.cert ?? null,
	)
}
