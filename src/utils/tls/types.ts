export type TlsMaterialType = {
	cert: Buffer
	key: Buffer
	ca: Buffer | null
	requireClientCert: boolean
	certFile: string
	keyFile: string
	caFile: string | null
}

export type HttpSchemeType = "http" | "https"
