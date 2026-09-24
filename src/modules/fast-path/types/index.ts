import type { OriginCapabilitiesType } from "@/modules/skill-engine/types"
import type {
	ClockTwelveAmType,
	ClockWordsType,
} from "@/utils/language-catalogs/types"

export type FastPathAstNodeType =
	| { kind: "text"; value: string }
	| { kind: "slot"; name: string }
	| { kind: "optional"; body: FastPathAstNodeType[] }
	| { kind: "group"; alternatives: FastPathAstNodeType[][] }

export type FastPathSlotValueType = {
	phrase: string
	folded: string
	args: Record<string, unknown>
	target: string | null
}

export type CompiledSlotType =
	| { kind: "values"; values: FastPathSlotValueType[] }
	| { kind: "range"; min: number; max: number; arg: string }
	| { kind: "duration"; maxSeconds: number; arg: string }
	| { kind: "clockTime"; arg: string }

export type FastPathCaptureType = FastPathSlotValueType | number | string

export type CompiledTemplateType = {
	ast: FastPathAstNodeType[]
	prefilter: RegExp
	source: string
}

export type CompiledIntentType = {
	tool: string
	namespacedName: string
	providerSlug: string
	templates: CompiledTemplateType[]
	slots: Map<string, CompiledSlotType>
	requiredKeywords: string[][]
	argDefaults: Record<string, unknown>
	priority: number
	allowBlockedTokens: boolean
	builtin: boolean
	available: ((origin: OriginCapabilitiesType) => boolean) | null
}

export type CompiledFastPathIndexType = {
	intents: CompiledIntentType[]
	dynamicHash: string
	builtAt: number
}

export type BareEntityMatchType = {
	name: string
	phrase: string
	providerSlug: string
}

export type FastPathMatchType = {
	tool: string
	namespacedName: string
	providerSlug: string
	args: Record<string, unknown>
	resolvedArgs: Record<string, unknown>
	literalChars: number
	slotChars: number
	coverage: number
	priority: number
	template: string
}

export type FastPathCandidateVerdictType =
	| { kind: "match"; match: FastPathMatchType }
	| { kind: "ambiguous" }
	| { kind: "unavailable" }
	| { kind: "none" }

export type FastPathMissReasonType =
	| "disabled"
	| "no_index"
	| "too_long"
	| "blocked_token"
	| "no_match"
	| "ambiguous"
	| "unavailable"

export type FastPathUntimedVerdictType =
	| { kind: "match"; match: FastPathMatchType }
	| { kind: "compound"; matches: FastPathMatchType[] }
	| { kind: "miss"; reason: FastPathMissReasonType }

export type FastPathVerdictType =
	| { kind: "match"; match: FastPathMatchType; fastPathMs: number }
	| { kind: "compound"; matches: FastPathMatchType[]; fastPathMs: number }
	| { kind: "miss"; reason: FastPathMissReasonType; fastPathMs: number }

export type FastPathParseResultType = {
	consumed: boolean
	literalChars: number
	slotChars: number
	captures: Map<string, FastPathCaptureType>
}

export type NumberSetsType = {
	words: Record<string, number>
	joiners: string[]
	durationUnits: Record<string, number>
	durationPhrases: Record<string, number>
	unitArticles: string[]
	clockWords: ClockWordsType
	clockTwelveAm: ClockTwelveAmType
}

export type FastPathMatchStateType = {
	pos: number
	literalChars: number
	slotChars: number
	captures: Map<string, FastPathCaptureType>
}

export type FastPathMatchOptionsType = {
	blocked: boolean
	providersEnabled: boolean
	origin: OriginCapabilitiesType | null
}

export type FastPathCandidatesType = {
	candidates: FastPathMatchType[]
	skippedUnavailable: number
}

export type FastPathEligibilityType =
	| "ok"
	| "blocked"
	| "unavailable"
	| "disabled"
