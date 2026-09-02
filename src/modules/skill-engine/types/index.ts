import type {
	SelectSkillProviderType,
	ToolFinalizeMapType,
	SkillToolType,
	DomiaSkillDescriptorType,
	ToolPolicyType,
	ToolHintOverrideType,
	ToolRiskClassType,
	ToolAnnotationsType,
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
	toolHints: Record<string, ToolHintOverrideType>
	paramAllow: Record<string, string[]>
	finalize: ToolFinalizeMapType
	genericWords: string[]
	resilience: ResolvedSkillResilienceType
}

export type ResolvedToolMetaType = {
	rawName: string
	riskClass: ToolRiskClassType
	idempotent: boolean
	openWorld: boolean
	cancellable: boolean
	policy: ToolPolicyType
	policySource: "descriptor" | "risk_default"
	timeoutMs: number | null
	allowedActors: string[] | null
}

export type EffectiveHintsType = {
	readOnly: boolean | undefined
	destructive: boolean | undefined
	idempotent: boolean | undefined
	openWorld: boolean | undefined
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
	interceptToolCall?: (
		provider: SelectSkillProviderType,
		rawName: string,
		args: Record<string, unknown>,
	) => { text: string } | null
	resolveArgs?: (
		provider: SelectSkillProviderType,
		rawName: string,
		args: Record<string, unknown>,
		language?: string | null,
	) => Promise<Record<string, unknown>> | Record<string, unknown>
	invocationRisk?: (
		provider: SelectSkillProviderType,
		rawName: string,
		resolvedArgs: Record<string, unknown>,
	) => ToolRiskClassType | null
	fastPathSlotValues?: (
		provider: SelectSkillProviderType,
		key: string,
		language: string | null,
	) => { phrase: string; args: Record<string, unknown> }[] | null
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
	| "cancelled"

export type SkillCallResultType = {
	text: string
	status: SkillCallStatusType
	isError: boolean
	resolvedArgs?: Record<string, unknown>
	speakableText?: string
	structured?: unknown
}

export type SkillCallToolOptionsType = {
	onProgress?: (message: string | null) => void
	timeoutMs?: number
}

export type RawSkillToolType = {
	name: string
	description?: string
	inputSchema?: Record<string, unknown>
	outputSchema?: Record<string, unknown>
	annotations?: ToolAnnotationsType
}

export type SkillConnHandleType = {
	listTools: () => Promise<RawSkillToolType[]>
	callTool: (
		rawName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
		opts?: SkillCallToolOptionsType,
	) => Promise<SkillCallResultType>
	close: () => Promise<void>
}

export type SkillElicitResultType =
	| { action: "accept"; content: Record<string, unknown> }
	| { action: "decline" }
	| { action: "cancel" }

export type SkillConnHooksType = {
	onToolListChanged?: () => void
	onElicit?: (
		message: string,
		requestedSchema: Record<string, unknown> | undefined,
	) => Promise<SkillElicitResultType>
}

export type SkillAdapterType = {
	protocol: string
	connect: (
		cfg: SelectSkillProviderType,
		hooks?: SkillConnHooksType,
	) => Promise<SkillConnHandleType>
}

export type SkillConnectionType = {
	providerId: string
	providerSlug: string
	name: string
	maxResultChars: number
	timeoutMs: number
	allowedTools: Set<string>
	descriptor: ResolvedSkillDescriptorType
	toolMeta: Map<string, ResolvedToolMetaType>
	language: string | null
	provider: SelectSkillProviderType
	specialization: SkillSpecializationType | null
	handle: SkillConnHandleType
}
