export type MeshSecretSlotType = "current" | "next"

export type MeshSecretPostureType = {
	rotating: boolean
	signingWith: MeshSecretSlotType
	accepted: MeshSecretSlotType[]
	graceMs: number
	graceEndsAt: string | null
	fingerprints: Record<MeshSecretSlotType, string | null>
}

export type MeshSecretRingArgsType = {
	current: string
	next?: string
	graceMs: number
	now?: () => number
}

export type MeshSecretRingType = {
	signingSecret: () => string
	acceptedSecrets: () => string[]
	accepts: (candidate: string | undefined) => boolean
	isSigningSecret: (candidate: string | undefined) => boolean
	setGraceMs: (ms: number) => void
	restartGrace: () => void
	endGrace: () => void
	posture: () => MeshSecretPostureType
}

export type MeshControlEnvelopeType = {
	issuedAt: number
	bootId: string
	sequence: number
}

export type MeshSignedControlPayloadType = Record<string, unknown> &
	MeshControlEnvelopeType & { signature: string }

export type MeshReplaySlotType = {
	bootId: string
	sequence: number
}

export type MeshReplayGuardType = {
	lastSeen: (key: string) => MeshReplaySlotType | undefined
	accept: (key: string, slot: MeshReplaySlotType) => boolean
	forget: (key: string) => void
}

export type MeshControlRejectReasonType =
	| "malformed"
	| "identity-mismatch"
	| "unsigned"
	| "bad-signature"
	| "stale"
	| "replayed"
	| "unknown-boot"

export type MeshControlVerdictType = {
	accepted: boolean
	reason: MeshControlRejectReasonType | null
	identity: string
}

export type MeshDropWarnSlotType = {
	identity: string
	reason: MeshControlRejectReasonType
	label: string
	windowStartedAt: number
	suppressed: number
}

export type MeshDropWarnSummaryType = {
	identity: string
	reason: MeshControlRejectReasonType
	label: string
	suppressed: number
	windowMs: number
}

export type MeshDropWarnDecisionType = {
	emit: boolean
	summary: MeshDropWarnSummaryType | null
}

export type RecordMeshDropWarnArgsType = {
	identity: string
	reason: MeshControlRejectReasonType
	label: string
	now?: number
}

export type MeshDropWarnThrottleArgsType = {
	windowMs: number
}

export type MeshDropWarnThrottleType = {
	record: (args: RecordMeshDropWarnArgsType) => MeshDropWarnDecisionType
	sweep: (now?: number) => MeshDropWarnSummaryType[]
	size: () => number
}

export type MeshIdentityFieldType = "domiaKey" | "nodeId"

export type VerifyMeshControlArgsType = {
	payload: Record<string, unknown> | null
	topicIdentity: string
	identityField: MeshIdentityFieldType
	toleranceMs: number
	guard: MeshReplayGuardType
	isLastWill?: boolean
	secret?: string
	now?: number
}
