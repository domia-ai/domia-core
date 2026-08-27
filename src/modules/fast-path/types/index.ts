export type FastPathAstNodeType =
	| { kind: "text"; value: string }
	| { kind: "slot"; name: string }
	| { kind: "optional"; body: FastPathAstNodeType[] }
	| { kind: "group"; alternatives: FastPathAstNodeType[][] }

export type FastPathSlotValueType = {
	phrase: string
	folded: string
	args: Record<string, unknown>
}

export type CompiledSlotType =
	| { kind: "values"; values: FastPathSlotValueType[] }
	| { kind: "range"; min: number; max: number; arg: string }

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
}

export type CompiledFastPathIndexType = {
	intents: CompiledIntentType[]
	dynamicHash: string
	builtAt: number
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
	template: string
}

export type FastPathVerdictType =
	| { kind: "match"; match: FastPathMatchType; fastPathMs: number }
	| {
			kind: "miss"
			reason:
				| "disabled"
				| "no_index"
				| "too_long"
				| "blocked_token"
				| "no_match"
				| "ambiguous"
				| "rebuilding"
			fastPathMs: number
	  }

export type FastPathParseResultType = {
	consumed: boolean
	literalChars: number
	slotChars: number
	captures: Map<string, FastPathSlotValueType | number>
}
