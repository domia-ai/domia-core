export const DOMIA_BUNDLE_OMIT_KEYS = [
	"id",
	"domiaKey",
	"isActive",
	"isHosted",
	"localIp",
	"grpcPort",
	"grpcTls",
	"lastSeenAt",
	"peerNodeId",
	"configRevision",
	"configReloadDrainMs",
	"createdAt",
	"updatedAt",
] as const

export const DOMIA_BUNDLE_OMIT_MASK = Object.fromEntries(
	DOMIA_BUNDLE_OMIT_KEYS.map((key) => [key, true]),
) as Record<(typeof DOMIA_BUNDLE_OMIT_KEYS)[number], true>
