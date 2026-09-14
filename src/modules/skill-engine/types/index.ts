import type {
	SelectSkillProviderType,
	ToolFinalizeMapType,
	SkillToolType,
	DomiaSkillDescriptorType,
	ToolPolicyType,
	ToolHintOverrideType,
	ToolRiskClassType,
	ToolAnnotationsType,
	ArgNormalizeMapType,
} from "@/db"
import type { LanguageCatalogExtensionType } from "@/utils"

export type ResolvedSkillResilienceType = {
	retryMaxAttempts: number
	retryBackoffMs: number
	breakerThreshold: number
	breakerCooldownMs: number
	idempotentWithinTurn: boolean
	serveStaleTools: boolean
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
	argNormalize: ArgNormalizeMapType
	finalize: ToolFinalizeMapType
	genericWords: string[]
	resilience: ResolvedSkillResilienceType
}

export type HintSourceType = "descriptor" | "annotation" | "default"

export type HintNameType =
	| "readOnly"
	| "destructive"
	| "idempotent"
	| "openWorld"

export type ResolvedToolMetaType = {
	rawName: string
	riskClass: ToolRiskClassType
	idempotent: boolean
	openWorld: boolean
	cancellable: boolean
	policy: ToolPolicyType
	policySource: "descriptor" | "risk_default"
	hintSources: Record<HintNameType, HintSourceType>
	timeoutMs: number | null
	allowedActors: string[] | null
}

export type EffectiveHintsType = {
	readOnly: boolean | undefined
	destructive: boolean | undefined
	idempotent: boolean | undefined
	openWorld: boolean | undefined
	sources: Record<HintNameType, HintSourceType>
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
	virtualTools?: (
		provider: SelectSkillProviderType,
		language: string | null,
	) => RawSkillToolType[]
	callVirtualTool?: (
		provider: SelectSkillProviderType,
		handle: SkillConnHandleType,
		rawName: string,
		args: Record<string, unknown>,
		language: string | null,
		signal?: AbortSignal,
	) => Promise<SkillCallResultType> | null
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
	describeInvocation?: (
		provider: SelectSkillProviderType,
		rawName: string,
		args: Record<string, unknown>,
		language: string | null,
	) => ToolInvocationDescriptionType | null
	inferWriteTarget?: (
		provider: SelectSkillProviderType,
		rawName: string,
		args: Record<string, unknown>,
		transcript: string,
		language: string | null,
	) => ToolTargetInferenceType
	preCall?: (
		provider: SelectSkillProviderType,
		rawName: string,
		args: Record<string, unknown>,
	) => Promise<Record<string, unknown>> | Record<string, unknown>
	postCall?: (
		provider: SelectSkillProviderType,
		rawName: string,
		resolvedArgs: Record<string, unknown>,
		result: SkillCallResultType,
		language: string | null,
	) => Promise<SkillCallResultType> | SkillCallResultType
	status?: (provider: SelectSkillProviderType) => Record<string, unknown> | null
	discover?: (timeoutMs: number) => Promise<DiscoveredProviderType[]>
	catalogExtensions?: Record<string, LanguageCatalogExtensionType>
}

export type DiscoveredProviderType = {
	kind: string
	name: string
	url: string
	host: string
	port: number
	version: string | null
}

export type SkillToolStatusType = {
	rawName: string
	riskClass: ToolRiskClassType
	policy: ToolPolicyType
	policySource: "descriptor" | "risk_default"
	retryable: boolean
	openWorld: boolean
	hintSources: Record<HintNameType, HintSourceType>
}

export type SkillProviderStatusType = {
	id: string
	name: string
	kind: string | null
	trustTier: string
	connected: boolean
	cachedTools: number
	allowedTools: number
	lastSyncAt: string | null
	toolsFreshUntil: string | null
	toolsRefreshMs: number
	protocolEra: SkillProtocolEraType | null
	tools: SkillToolStatusType[]
	specialization: Record<string, unknown> | null
}

export type SkillsRefreshOptionsType = {
	force: boolean
}

export type ListToolsOptionsType = {
	force?: boolean
}

export type ToolInvocationDescriptionType = {
	target?: string
	targetNames?: string[]
	implicit?: boolean
	summary?: string
}

export type ToolTargetInferenceType =
	| { kind: "targeted" }
	| { kind: "inferred"; args: Record<string, unknown> }
	| { kind: "untargeted" }

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

export type RawSkillToolListType = {
	tools: RawSkillToolType[]
	ttlMs?: number
}

export type SkillProtocolEraType = "legacy" | "modern"

export type SkillConnHandleType = {
	listTools: () => Promise<RawSkillToolListType>
	callTool: (
		rawName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
		opts?: SkillCallToolOptionsType,
	) => Promise<SkillCallResultType>
	protocolEra?: () => SkillProtocolEraType | null
	close: () => Promise<void>
}

export type McpContentPartType = {
	type?: unknown
	text?: unknown
	annotations?: { audience?: unknown }
}

export type SkillRenderedContentType = {
	text: string
	speakableText: string | null
	droppedParts: number
}

export type ValidatedElicitResultType =
	| {
			action: "accept"
			content: Record<string, string | number | boolean | string[]>
	  }
	| { action: "decline" }
	| { action: "cancel" }

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
	transports: readonly string[]
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
	toolsFreshUntil: number | null
	language: string | null
	provider: SelectSkillProviderType
	specialization: SkillSpecializationType | null
	handle: SkillConnHandleType
}

export type BreakerStateType = { failures: number; openUntil: number }
