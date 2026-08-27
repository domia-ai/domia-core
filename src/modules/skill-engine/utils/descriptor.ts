import {
	type SelectSkillProviderType,
	type DomiaSkillDescriptorType,
	type SkillDescriptorLocaleType,
	type ToolFinalizeMapType,
	DEFAULT_SKILL_RETRY_MAX_ATTEMPTS,
	DEFAULT_SKILL_RETRY_BACKOFF_MS,
	DEFAULT_SKILL_BREAKER_THRESHOLD,
	DEFAULT_SKILL_BREAKER_COOLDOWN_MS,
	DEFAULT_SKILL_IDEMPOTENT_WITHIN_TURN,
} from "@/db"
import { skillEngineLogger } from "@/utils"
import { domiaSkillDescriptorSchema } from "../schemas"
import { resolveSpecializationByKind } from "../specializations"
import type { ResolvedSkillDescriptorType } from "../types"

const cache = new Map<string, ResolvedSkillDescriptorType>()
const warned = new Set<string>()

const mergeAliases = (
	...maps: (Record<string, string[]> | undefined)[]
): Record<string, string[]> => {
	const out: Record<string, string[]> = {}
	for (const map of maps) {
		if (!map) continue
		for (const [k, v] of Object.entries(map))
			out[k] = [...new Set([...(out[k] ?? []), ...v])]
	}
	return out
}

const concatUnique = (...lists: (string[] | undefined)[]): string[] => {
	const out = new Set<string>()
	for (const list of lists) for (const item of list ?? []) out.add(item)
	return [...out]
}

const mergeFinalize = (
	...maps: (ToolFinalizeMapType | undefined)[]
): ToolFinalizeMapType => {
	const out: ToolFinalizeMapType = {}
	for (const map of maps) if (map) Object.assign(out, map)
	return out
}

const parseDescriptor = (
	provider: SelectSkillProviderType,
): DomiaSkillDescriptorType | null => {
	if (!provider.descriptor) return null
	const result = domiaSkillDescriptorSchema.safeParse(provider.descriptor)
	if (result.success) return result.data
	if (!warned.has(provider.id)) {
		warned.add(provider.id)
		skillEngineLogger.warn("invalid skill descriptor — ignoring", {
			provider: provider.name,
			issues: result.error.issues.map((i) => i.message),
		})
	}
	return null
}

export const resolveDescriptor = (
	provider: SelectSkillProviderType,
	language: string | null,
): ResolvedSkillDescriptorType => {
	const cacheKey = `${provider.id}|${provider.updatedAt}|${provider.lastSyncAt ?? ""}|${language ?? ""}`
	const cached = cache.get(cacheKey)
	if (cached) return cached

	const descriptor = parseDescriptor(provider)
	const spec = resolveSpecializationByKind(descriptor?.kind)
	const defaults = spec?.descriptorDefaults?.(
		provider.toolsCache ?? [],
		language,
	)
	const locale: SkillDescriptorLocaleType | undefined = language
		? (descriptor?.i18n?.[language] ?? defaults?.i18n?.[language])
		: undefined

	const dRoot = descriptor?.routing
	const dExec = descriptor?.execution
	const fRoot = defaults?.routing
	const fExec = defaults?.execution

	const resolved: ResolvedSkillDescriptorType = {
		kind: descriptor?.kind ?? null,
		description: descriptor?.description ?? defaults?.description ?? null,
		aliases: mergeAliases(fRoot?.aliases, dRoot?.aliases, locale?.aliases),
		exampleUtterances: concatUnique(
			fRoot?.exampleUtterances,
			dRoot?.exampleUtterances,
			locale?.exampleUtterances,
		),
		keywords: concatUnique(fRoot?.keywords, dRoot?.keywords, locale?.keywords),
		coreTools: concatUnique(fExec?.coreTools, dExec?.coreTools),
		toolPolicy: { ...fExec?.toolPolicy, ...dExec?.toolPolicy },
		toolHints: { ...fExec?.toolHints, ...dExec?.toolHints },
		paramAllow: { ...fExec?.paramAllow, ...dExec?.paramAllow },
		finalize: mergeFinalize(fExec?.finalize, dExec?.finalize, locale?.finalize),
		genericWords: concatUnique(
			fExec?.genericWords,
			dExec?.genericWords,
			locale?.genericWords,
		),
		resilience: {
			retryMaxAttempts:
				dExec?.resilience?.retryMaxAttempts ??
				fExec?.resilience?.retryMaxAttempts ??
				DEFAULT_SKILL_RETRY_MAX_ATTEMPTS,
			retryBackoffMs:
				dExec?.resilience?.retryBackoffMs ??
				fExec?.resilience?.retryBackoffMs ??
				DEFAULT_SKILL_RETRY_BACKOFF_MS,
			breakerThreshold:
				dExec?.resilience?.breakerThreshold ??
				fExec?.resilience?.breakerThreshold ??
				DEFAULT_SKILL_BREAKER_THRESHOLD,
			breakerCooldownMs:
				dExec?.resilience?.breakerCooldownMs ??
				fExec?.resilience?.breakerCooldownMs ??
				DEFAULT_SKILL_BREAKER_COOLDOWN_MS,
			idempotentWithinTurn:
				dExec?.resilience?.idempotentWithinTurn ??
				fExec?.resilience?.idempotentWithinTurn ??
				DEFAULT_SKILL_IDEMPOTENT_WITHIN_TURN,
		},
	}
	cache.set(cacheKey, resolved)
	return resolved
}
