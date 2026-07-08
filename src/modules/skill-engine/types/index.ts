import type {
	SelectSkillProviderType,
	ToolFinalizeMapType,
	SkillToolType,
	DomiaSkillDescriptorType,
	ToolPolicyType,
} from "@/db"

export type ResolvedSkillResilienceType = {
	retryMaxAttempts: number
	retryBackoffMs: number
	breakerThreshold: number
	breakerCooldownMs: number
	idempotentWithinTurn: boolean
}

export type ResolvedSkillDescriptorType = {
	kind: string | null
	description: string | null
	aliases: Record<string, string[]>
	exampleUtterances: string[]
	keywords: string[]
	coreTools: string[]
	toolPolicy: Record<string, ToolPolicyType>
	paramAllow: Record<string, string[]>
	finalize: ToolFinalizeMapType
	genericWords: string[]
	resilience: ResolvedSkillResilienceType
}

export type ToolShortlistResultType = {
	tools: SkillToolType[]
	total: number
	dropped: number
	applied: boolean
}

export type ToolShortlistOptionsType = {
	coreNames?: Set<string>
	confMin?: number
}

export type ToolManifestType = {
	aliases: Record<string, string[]>
	coreNames: Set<string>
	exampleUtterances: string[]
	keywords: string[]
}

export type SkillSpecializationType = {
	kind: string
	descriptorDefaults?: (
		tools: SkillToolType[],
		language: string | null,
	) => DomiaSkillDescriptorType
	onConnected?: (
		provider: SelectSkillProviderType,
		handle: SkillConnHandleType,
	) => Promise<void> | void
	onDisconnected?: (provider: SelectSkillProviderType) => Promise<void> | void
	resolveArgs?: (
		provider: SelectSkillProviderType,
		rawName: string,
		args: Record<string, unknown>,
		language?: string | null,
	) => Promise<Record<string, unknown>> | Record<string, unknown>
}

export type HaEntityType = {
	names: string[]
	domain: string
	area: string | null
	entityId?: string
	state?: string | null
	lastChanged?: string | null
}

export type HaContextSourceType = "ws" | "poll"

export type HaContextCacheType = {
	entities: HaEntityType[]
	areas: Set<string>
	fetchedAt: number
	handle: SkillConnHandleType
	source?: HaContextSourceType
}

export type HaWsStateType =
	| "idle"
	| "connecting"
	| "authenticating"
	| "syncing"
	| "live"
	| "backoff"
	| "closed"

export type HaLiveEntityType = {
	entityId: string
	state: string | null
	friendlyName: string | null
	names: string[]
	domain: string
	area: string | null
	lastChanged: string | null
}

export type HaRegistryEntityType = {
	entityId: string
	name: string | null
	originalName: string | null
	aliases: string[]
	areaId: string | null
	deviceId: string | null
	disabled: boolean
	hidden: boolean
}

export type HaRegistryAreaType = {
	areaId: string
	name: string
}

export type HaRegistryDeviceType = {
	deviceId: string
	areaId: string | null
}

export type HaStateObjectType = {
	entity_id: string
	state?: string | null
	attributes?: Record<string, unknown>
	last_changed?: string | null
}

export type HaWsMessageType = {
	id?: number
	type?: string
	success?: boolean
	result?: unknown
	error?: unknown
	message?: string
	event?: {
		event_type?: string
		data?: {
			entity_id?: string
			new_state?: HaStateObjectType | null
		}
	}
}

export type HaWsSnapshotType = {
	states: HaStateObjectType[]
	entityRegistry: HaRegistryEntityType[]
	areaRegistry: HaRegistryAreaType[]
	deviceRegistry: HaRegistryDeviceType[]
	exposedEntityIds: Set<string> | null
}

export type HaWsClientOptionsType = {
	wsUrl: string
	token: string
	onSync: (snapshot: HaWsSnapshotType) => void
	onEvent: (entityId: string, newState: HaStateObjectType | null) => void
	onStatus: (state: HaWsStateType, reason?: string) => void
}

export type HaWsClientType = {
	connect: () => void
	close: () => void
	state: () => HaWsStateType
}

export type HaDestinationType = {
	key: string
	wsUrl: string
	client: HaWsClientType
	attachedProviderIds: Set<string>
	entities: Map<string, HaLiveEntityType>
	areasById: Map<string, string>
	devicesById: Map<string, string | null>
	registryByEntityId: Map<string, HaRegistryEntityType>
	exposedEntityIds: Set<string> | null
	live: boolean
	dirty: boolean
	snapshot: HaContextCacheType | null
	overflowWarned: boolean
}

export type HaDataPlaneConfigType = {
	dataPlane: "ws" | "poll"
	wsUrl: string | null
}

export type SkillCallStatusType =
	| "ok"
	| "error"
	| "blocked"
	| "timeout"
	| "unauthorized"

export type SkillCallResultType = {
	text: string
	status: SkillCallStatusType
	isError: boolean
	resolvedArgs?: Record<string, unknown>
}

export type RawSkillToolType = {
	name: string
	description?: string
	inputSchema?: Record<string, unknown>
}

export type SkillConnHandleType = {
	listTools: () => Promise<RawSkillToolType[]>
	callTool: (
		rawName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<SkillCallResultType>
	close: () => Promise<void>
}

export type SkillAdapterType = {
	protocol: string
	connect: (cfg: SelectSkillProviderType) => Promise<SkillConnHandleType>
}

export type SkillConnectionType = {
	providerId: string
	providerSlug: string
	name: string
	maxResultChars: number
	timeoutMs: number
	allowedTools: Set<string>
	descriptor: ResolvedSkillDescriptorType
	language: string | null
	provider: SelectSkillProviderType
	specialization: SkillSpecializationType | null
	handle: SkillConnHandleType
}
