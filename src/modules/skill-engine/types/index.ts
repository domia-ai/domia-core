import type { ZodType } from "zod"

import type {
	SelectSkillProviderType,
	ToolFinalizeMapType,
	ToolFinalizeRuleType,
	SkillToolType,
	DomiaSkillDescriptorType,
	FastPathIntentType,
	ToolPolicyType,
	ToolHintOverrideType,
	ToolRiskClassType,
	ToolAnnotationsType,
	ArgNormalizeMapType,
	SelectProactiveScheduleType,
	ToolRunStatusEnumType,
} from "@/db"
import type {
	LanguageCatalogExtensionType,
	ResolvedLanguageSetsType,
} from "@/utils"
import type { DomiaType } from "@/modules/core"

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
	hiddenTools: string[]
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
	hiddenNames: Set<string>
	builtinNames: Set<string>
	builtinKeywords: string[]
	exampleUtterances: string[]
	keywords: string[]
}

export type OriginCapabilitiesType = {
	source: string
	satelliteId: string | null
	satelliteProtocol: string | null
	connected: boolean
	canSpeak: boolean
	canAnnounce: boolean
	canFollowUp: boolean
	canConfirm: boolean
	timerNative: boolean
	volumeNative: boolean
	localPlayback: boolean
}

export type SkillSpecializationType = {
	kind: string
	descriptorDefaults?: (
		tools: SkillToolType[],
		language: string | null,
		provider?: SelectSkillProviderType,
	) => DomiaSkillDescriptorType
	toolAvailability?: (
		provider: SelectSkillProviderType,
		rawName: string,
		origin: OriginCapabilitiesType,
	) => boolean
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
	namespacedName: string
	riskClass: ToolRiskClassType
	policy: ToolPolicyType
	policySource: "descriptor" | "risk_default"
	retryable: boolean
	openWorld: boolean
	hidden: boolean
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
	providerIds?: string[]
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
	readDescriptor?: (
		knownTools?: SkillToolType[],
	) => Promise<ServerDescriptorReadType>
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
	invokeTool?: (
		namespacedName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
		step?: RoutineStepContextType,
	) => Promise<SkillCallResultType>
}

export type RoutineStepContextType = {
	routineSlug: string
	stepIndex: number
}

export type ToolCallContextType = {
	sequence?: number
	routineSlug?: string | null
	stepIndex?: number | null
}

export type ToolRunFilterType = {
	interactionId?: string
	tool?: string
	statuses?: ToolRunStatusEnumType[]
	since?: string
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

export type IngestedServerDescriptorType = {
	descriptor: DomiaSkillDescriptorType
	hash: string
}

export type ServerDescriptorReadType =
	| { status: "absent" }
	| { status: "invalid" }
	| ({ status: "ok" } & IngestedServerDescriptorType)

export type ServerDescriptorIngestContextType = {
	provider: string
	knownTools?: SkillToolType[]
}

export type ServerDescriptorSourceType = {
	hasResources: () => boolean
	listResources: (
		cursor?: string,
	) => Promise<{ resources: { uri: string }[]; nextCursor?: string }>
	readResource: (uri: string) => Promise<{ contents: unknown[] }>
}

export type SkillRuntimeAnnounceTargetType =
	| { kind: "satellite"; satelliteId: string }
	| { kind: "local" }
	| { kind: "none" }

export type SkillRuntimeTimerKindType = "timer" | "reminder" | "alarm"

export type SkillRuntimeTimerStartInputType = {
	domia: DomiaType
	origin: OriginCapabilitiesType
	seconds: number
	label: string
	kind: SkillRuntimeTimerKindType
	text?: string
	dueAt?: string
	repeatDailyAt?: string | null
	templateParams?: Record<string, string>
}

export type SkillRuntimeTimerType = {
	id: string
	kind: SkillRuntimeTimerKindType
	label: string
	text: string | null
	dueAt: string
	remainingSeconds: number
	totalSeconds: number
	targetKind: SelectProactiveScheduleType["targetKind"]
	targetSatelliteId: string | null
}

export type SkillRuntimeTimerStartResultType = {
	timer: SkillRuntimeTimerType
	destination: SkillRuntimeAnnounceTargetType
	destinationName: string | null
}

export type SkillRuntimeScheduleCreateInputType = {
	domia: DomiaType
	origin: OriginCapabilitiesType
	name: string
	text: string | null
	templateKey: string | null
	templateParams: Record<string, string> | null
	dueAt: string
	importance: SelectProactiveScheduleType["importance"]
	repeatDailyAt?: string | null
}

export type SkillRuntimeFactInputType = {
	subject: string
	relation: string
	value: string
	evidenceInteractionId: string | null
}

export type SkillRuntimeFactWriteResultType = {
	written: boolean
	reason: string | null
}

export type SkillRuntimePortType = {
	domiaOf: (domiaId: string) => Promise<DomiaType | null>
	originCapabilities: (
		domia: DomiaType,
		satelliteId: string | undefined,
		source: string,
	) => OriginCapabilitiesType
	announceTarget: (
		domiaId: string,
		origin: OriginCapabilitiesType,
	) => SkillRuntimeAnnounceTargetType
	timers: {
		start: (
			input: SkillRuntimeTimerStartInputType,
		) => Promise<SkillRuntimeTimerStartResultType>
		cancel: (
			domia: DomiaType,
			origin: OriginCapabilitiesType,
			kind: SkillRuntimeTimerKindType,
		) => Promise<SkillRuntimeTimerType[]>
		list: (
			domia: DomiaType,
			origin: OriginCapabilitiesType,
			kind: SkillRuntimeTimerKindType,
		) => Promise<SkillRuntimeTimerType[]>
		remaining: (timer: SkillRuntimeTimerType) => number
	}
	schedule: {
		create: (
			input: SkillRuntimeScheduleCreateInputType,
		) => Promise<SelectProactiveScheduleType>
		cancel: (
			domia: DomiaType,
			id: string,
		) => Promise<SelectProactiveScheduleType | null>
		list: (domia: DomiaType) => Promise<SelectProactiveScheduleType[]>
		wakeAt: (domia: DomiaType, atMs: number) => void
	}
	lastReply: (
		domia: DomiaType,
		excludeInteractionId: string | null,
	) => Promise<string | null>
	volume: {
		get: (
			domia: DomiaType,
			origin: OriginCapabilitiesType,
		) => Promise<number | null>
		set: (
			domia: DomiaType,
			origin: OriginCapabilitiesType,
			level: number,
		) => Promise<number | null>
	}
	facts: {
		upsert: (
			domia: DomiaType,
			fact: SkillRuntimeFactInputType,
		) => Promise<SkillRuntimeFactWriteResultType>
		expire: (domia: DomiaType, what: string) => Promise<number>
	}
	memory: {
		markReflectionCaptured: (interactionId: string) => void
	}
}

export type BuiltinAvailabilityContextType = {
	domiaId: string
	runtime: SkillRuntimePortType
}

export type BuiltinToolContextType = {
	domia: DomiaType
	language: string | null
	sets: ResolvedLanguageSetsType
	interactionId: string | null
	originDomiaKey: string
	origin: OriginCapabilitiesType
	runtime: SkillRuntimePortType
	signal?: AbortSignal
}

export type BuiltinToolPackIntentType = Omit<FastPathIntentType, "tool">

export type BuiltinToolPackSampleType = {
	text: string
	args?: Record<string, unknown>
}

export type BuiltinToolPackType = {
	intents?: BuiltinToolPackIntentType[]
	expansionRules?: Record<string, string>
	keywords?: string[]
	exampleUtterances?: string[]
	finalize: ToolFinalizeRuleType
	phrases?: Record<string, string>
	confirmSummary?: string
	samples?: BuiltinToolPackSampleType[]
}

export type BuiltinToolType = {
	name: string
	definition: RawSkillToolType
	schema: ZodType<Record<string, unknown>>
	packs: Record<string, BuiltinToolPackType>
	policy?: ToolPolicyType
	hiddenFromLlm?: boolean
	available?: (
		origin: OriginCapabilitiesType,
		ctx: BuiltinAvailabilityContextType,
	) => boolean
	execute: (
		args: Record<string, unknown>,
		ctx: BuiltinToolContextType,
	) => Promise<SkillCallResultType>
}

export type MediaOwnerSnapshotType = {
	folded: Set<string>
	version: number
}
