import type {
	ArgNormalizeOpType,
	HardwareClassType,
	BenchStageType,
	McpProtocolModeType,
} from "./types"

export type {
	ArgNormalizeOpType,
	HardwareClassType,
	BenchStageType,
	McpProtocolModeType,
}

export type SkillAuthType =
	| { kind: "bearer"; token: string }
	| { kind: "headers"; headers: Record<string, string> }

export type ToolAnnotationsType = {
	title?: string
	readOnlyHint?: boolean
	destructiveHint?: boolean
	idempotentHint?: boolean
	openWorldHint?: boolean
} & Record<string, unknown>

export type SkillToolType = {
	provider: string
	rawName: string
	namespacedName: string
	description?: string
	inputSchema: Record<string, unknown>
	outputSchema?: Record<string, unknown>
	annotations?: ToolAnnotationsType
}

export type ToolFinalizeRuleType = {
	mode: "agent_loop" | "template" | "async" | "deadline"
	ack?: string
	error?: string
	done?: string
	ackAfterMs?: number
}

export type ToolFinalizeMapType = Partial<Record<string, ToolFinalizeRuleType>>

export type SkillProviderConfigType = {
	protocolMode?: McpProtocolModeType
	dataPlane?: "ws" | "poll"
	wsUrl?: string
	command?: string
	commandArgs?: string[]
	commandEnv?: Record<string, string>
	rosterTtlMs?: number
	searchLimit?: number
	volumeStepPercent?: number
	playerAliases?: Record<string, string>
}

export type SkillDescriptorRoutingType = {
	aliases?: Record<string, string[]>
	exampleUtterances?: string[]
	keywords?: string[]
}

export type SkillResilienceConfigType = {
	retryMaxAttempts?: number
	retryBackoffMs?: number
	breakerThreshold?: number
	breakerCooldownMs?: number
	idempotentWithinTurn?: boolean
	serveStaleTools?: boolean
}

export type ToolPolicyType = "allow" | "block" | "confirm"

export type ToolRiskClassType = "read" | "write_additive" | "write_destructive"

export type ToolHintOverrideType = {
	readOnlyHint?: boolean
	destructiveHint?: boolean
	idempotentHint?: boolean
	openWorldHint?: boolean
	timeoutMs?: number
	cancellable?: boolean
}

export type ArgNormalizeMapType = Record<
	string,
	Record<string, ArgNormalizeOpType[]>
>

export type SkillDescriptorExecutionType = {
	coreTools?: string[]
	hiddenTools?: string[]
	toolPolicy?: Record<string, ToolPolicyType>
	toolHints?: Record<string, ToolHintOverrideType>
	paramAllow?: Record<string, string[]>
	argNormalize?: ArgNormalizeMapType
	finalize?: ToolFinalizeMapType
	genericWords?: string[]
	resilience?: SkillResilienceConfigType
}

export type FastPathMapValueType = { in: string[]; out: unknown }

export type FastPathSlotSourceType =
	| { kind: "context"; key: string }
	| { kind: "enum"; values: string[] }
	| { kind: "map"; values: FastPathMapValueType[] }
	| { kind: "schemaEnum"; arg: string }
	| { kind: "range"; min: number; max: number }
	| { kind: "duration"; maxSeconds?: number }
	| { kind: "clockTime" }

export type FastPathSlotType = {
	source: FastPathSlotSourceType
	arg?: string
}

export type FastPathIntentType = {
	tool: string
	templates: string[]
	slots?: Record<string, FastPathSlotType>
	requiredKeywords?: string[][]
	argDefaults?: Record<string, unknown>
	priority?: number
	allowBlockedTokens?: boolean
}

export type RoutineStepType = {
	tool: string
	args: Record<string, unknown>
}

export type FastPathBlockType = {
	intents: FastPathIntentType[]
	expansionRules?: Record<string, string>
}

export type SkillDescriptorLocaleType = SkillDescriptorRoutingType & {
	finalize?: ToolFinalizeMapType
	genericWords?: string[]
	fastPath?: FastPathBlockType
}

export type DomiaSkillDescriptorType = {
	version: 1
	kind?: string
	description?: string
	routing?: SkillDescriptorRoutingType
	execution?: SkillDescriptorExecutionType
	fastPath?: FastPathBlockType
	i18n?: Record<string, SkillDescriptorLocaleType>
}

export type ToolRunStatusType =
	| "ok"
	| "failed"
	| "timeout"
	| "cancelled"
	| "denied"

export type ToolResultErrorCodeType =
	| "error"
	| "blocked"
	| "unauthorized"
	| "timeout"

export type ToolTraceEntryType =
	| {
			kind: "result"
			tool: string
			status: ToolRunStatusType
			durationMs: number
			summaryForLlm: string
			output?: string
			displaySummary?: string
			errorCode?: ToolResultErrorCodeType
			args?: Record<string, unknown>
			resolvedArgs?: Record<string, unknown>
	  }
	| {
			kind: "dispatched"
			tool: string
			args?: Record<string, unknown>
	  }
	| {
			kind: "async_outcome"
			tool: string
			status: ToolRunStatusType
			summaryForLlm: string
			output?: string
			resolvedArgs?: Record<string, unknown>
	  }
	| {
			kind: "summary"
			decisionMs: number
			toolMs: number
			finalizeMs: number
			finalizeMode: string
			stopReason: string
	  }

export type TtsEngineConfigType = {
	referenceAudioPath?: string
	numSteps?: number
	voiceEmbeddingCacheCapacity?: number
	vocoderPath?: string
	lengthScale?: number
	chunkStreaming?: boolean
}

export type BenchThresholdsType = Record<
	HardwareClassType,
	Record<BenchStageType, number>
>

export type VoiceFeelFeaturesType = {
	turns: number
	earlyBargeInRate: number
	lateBargeInRate: number
	cutOffRate: number
	perceivedTtfaP50: number
	eouDelayP50: number
	noSpeechRate: number
}

export type VoiceFeelFeatureKeyType = keyof VoiceFeelFeaturesType

export type VoiceFeelConditionType = {
	feature: VoiceFeelFeatureKeyType
	op: "gt" | "lt"
	value: number
}

export type VoiceFeelKnobType = {
	section: string
	field: string
}

export type VoiceFeelRuleType = {
	id: string
	when: readonly VoiceFeelConditionType[]
	knob: VoiceFeelKnobType
	step: number
	min: number
	max: number
	minTurns: number
	enabled: boolean
}
