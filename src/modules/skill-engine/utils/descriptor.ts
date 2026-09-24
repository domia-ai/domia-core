import {
	type SelectSkillProviderType,
	type DomiaSkillDescriptorType,
	type SkillDescriptorLocaleType,
	type ToolFinalizeMapType,
	type ArgNormalizeMapType,
	DEFAULT_SKILL_RETRY_MAX_ATTEMPTS,
	DEFAULT_SKILL_SERVE_STALE_TOOLS,
	DEFAULT_SKILL_RETRY_BACKOFF_MS,
	DEFAULT_SKILL_BREAKER_THRESHOLD,
	DEFAULT_SKILL_BREAKER_COOLDOWN_MS,
	DEFAULT_SKILL_IDEMPOTENT_WITHIN_TURN,
} from "@/db"
import { skillEngineLogger } from "@/utils"
import { domiaSkillDescriptorSchema } from "../schemas"
import { resolveSpecializationByKind } from "../specializations"
import type { ResolvedSkillDescriptorType } from "../types"

const cache = new Map<
	string,
	{ key: string; resolved: ResolvedSkillDescriptorType }
>()
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

const mergeArgNormalize = (
	...maps: (ArgNormalizeMapType | undefined)[]
): ArgNormalizeMapType => {
	const out: ArgNormalizeMapType = {}
	for (const map of maps) {
		if (!map) continue
		for (const [tool, args] of Object.entries(map))
			out[tool] = Object.assign({}, out[tool], args)
	}
	return out
}

const parseDescriptorValue = (
	provider: SelectSkillProviderType,
	value: DomiaSkillDescriptorType | null | undefined,
	origin: "db" | "server",
): DomiaSkillDescriptorType | null => {
	if (!value) return null
	const result = domiaSkillDescriptorSchema.safeParse(value)
	if (result.success) return result.data
	const warnKey = `${provider.id}|${origin}`
	if (!warned.has(warnKey)) {
		warned.add(warnKey)
		skillEngineLogger.warn("invalid skill descriptor — ignoring", {
			provider: provider.name,
			origin,
			issues: result.error.issues.map((i) => i.message),
		})
	}
	return null
}

const parseDescriptor = (
	provider: SelectSkillProviderType,
): DomiaSkillDescriptorType | null =>
	parseDescriptorValue(provider, provider.descriptor, "db")

const parseServerDescriptor = (
	provider: SelectSkillProviderType,
): DomiaSkillDescriptorType | null =>
	parseDescriptorValue(provider, provider.serverDescriptor, "server")

export const resolveDescriptor = (
	provider: SelectSkillProviderType,
	language: string | null,
): ResolvedSkillDescriptorType => {
	const slot = `${provider.id}|${language ?? ""}`
	const cacheKey = `${provider.updatedAt}|${provider.lastSyncAt ?? ""}|${provider.serverDescriptorHash ?? ""}`
	const cached = cache.get(slot)
	if (cached?.key === cacheKey) return cached.resolved

	const descriptor = parseDescriptor(provider)
	const server = parseServerDescriptor(provider)
	const spec = resolveSpecializationByKind(descriptor?.kind)
	const defaults = spec?.descriptorDefaults?.(
		provider.toolsCache ?? [],
		language,
		provider,
	)
	const locale: SkillDescriptorLocaleType | undefined = language
		? (descriptor?.i18n?.[language] ??
			server?.i18n?.[language] ??
			defaults?.i18n?.[language])
		: undefined

	const dRoot = descriptor?.routing
	const dExec = descriptor?.execution
	const sRoot = server?.routing
	const sExec = server?.execution
	const fRoot = defaults?.routing
	const fExec = defaults?.execution

	const resolved: ResolvedSkillDescriptorType = {
		kind: descriptor?.kind ?? null,
		description:
			descriptor?.description ??
			server?.description ??
			defaults?.description ??
			null,
		aliases: mergeAliases(
			fRoot?.aliases,
			sRoot?.aliases,
			dRoot?.aliases,
			locale?.aliases,
		),
		exampleUtterances: concatUnique(
			fRoot?.exampleUtterances,
			sRoot?.exampleUtterances,
			dRoot?.exampleUtterances,
			locale?.exampleUtterances,
		),
		keywords: concatUnique(
			fRoot?.keywords,
			sRoot?.keywords,
			dRoot?.keywords,
			locale?.keywords,
		),
		coreTools: concatUnique(fExec?.coreTools, dExec?.coreTools),
		hiddenTools: concatUnique(fExec?.hiddenTools, dExec?.hiddenTools),
		toolPolicy: { ...fExec?.toolPolicy, ...dExec?.toolPolicy },
		toolHints: { ...fExec?.toolHints, ...dExec?.toolHints },
		paramAllow: { ...fExec?.paramAllow, ...dExec?.paramAllow },
		argNormalize: mergeArgNormalize(fExec?.argNormalize, dExec?.argNormalize),
		finalize: mergeFinalize(
			fExec?.finalize,
			sExec?.finalize,
			dExec?.finalize,
			locale?.finalize,
		),
		genericWords: concatUnique(
			fExec?.genericWords,
			sExec?.genericWords,
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
			serveStaleTools:
				dExec?.resilience?.serveStaleTools ??
				fExec?.resilience?.serveStaleTools ??
				DEFAULT_SKILL_SERVE_STALE_TOOLS,
		},
	}
	cache.set(slot, { key: cacheKey, resolved })
	return resolved
}
