export type ResolvedDelegateType = {
	domiaKey: string
	domiaId: string
	localIp: string | null
	grpcPort: number | null
	source: "explicit" | "discovered"
}
