import { browseService } from "@/modules/satellite-discovery"
import type {
	SelectSkillProviderType,
	ToolFinalizeMapType,
	SkillToolType,
	ToolHintOverrideType,
	FastPathBlockType,
	FastPathIntentType,
} from "@/db"
import {
	skillEngineLogger,
	languageSetsFor,
	parseLlmJson,
	domiaError,
	SKILL_ERRORS,
} from "@/utils"
import { foldText as fold, tokensOf } from "@/utils/text-tokens"

import type { SkillSpecializationType, SkillConnHandleType } from "../../types"
import { resolveDescriptor } from "../../utils/descriptor"
import { findToolByBaseName, toolBaseName } from "../../utils/tool-name"
import type { HaEntityType, HaContextCacheType } from "./types"
import {
	HA_SPECIALIZATION_KIND,
	HA_ALIASES,
	HA_CORE_RE,
	HA_PLACEHOLDER_RE,
	HA_CONTEXT_TTL_MS,
	HA_CONTEXT_TOOL,
	HA_NAME_MATCH_MIN,
	HA_FULL_COVERAGE_SCORE,
	HA_SENSITIVE_TOOL_RE,
	HA_SENSITIVE_DOMAIN_RE,
	HA_READ_TOOL_RE,
	HA_ACTION_VERBS,
	HA_CATALOG_EXTENSIONS,
	HA_FAST_PATH_LANGUAGES,
	HA_EXAMPLE_UTTERANCES,
	HA_MDNS_SERVICE_TYPE,
	HA_MCP_PATH,
} from "./constants"
import {
	attachDataPlane,
	detachDataPlane,
	snapshotContext,
	liveEntities,
	dataPlaneStatus,
} from "./data-plane"

const genericWordsFor = (
	provider: SelectSkillProviderType,
	language: string | null,
): Set<string> =>
	new Set(
		resolveDescriptor(provider, language).genericWords.map((w) => fold(w)),
	)

const contextCache = new Map<string, HaContextCacheType>()

const parseLiveContext = (text: string): HaEntityType[] => {
	const entities: HaEntityType[] = []
	let current: { names: string[]; domain: string; area: string | null } | null =
		null
	for (const raw of text.split("\n")) {
		const line = raw.trimEnd()
		const namesMatch = /^- names:\s*(.*)$/.exec(line)
		if (namesMatch) {
			if (current) entities.push(current)
			current = {
				names: namesMatch[1]
					.split(",")
					.map((n) => n.trim())
					.filter(Boolean),
				domain: "",
				area: null,
			}
			continue
		}
		if (!current) continue
		const cont = /^\s{4}(\S.*)$/.exec(line)
		if (cont && !line.includes(":")) {
			current.names.push(
				...cont[1]
					.split(",")
					.map((n) => n.trim())
					.filter(Boolean),
			)
			continue
		}
		const domainMatch = /^\s+domain:\s*(\S+)/.exec(line)
		if (domainMatch) current.domain = domainMatch[1]
		const areaMatch = /^\s+areas:\s*(.+)$/.exec(line)
		if (areaMatch) current.area = areaMatch[1].trim()
	}
	if (current) entities.push(current)
	return entities
}

const contextToolNames = new Map<string, string>()

const resolveContextToolName = async (
	providerId: string,
	handle: SkillConnHandleType,
	cached: readonly { rawName: string }[],
): Promise<string> => {
	const known = contextToolNames.get(providerId)
	if (known) return known
	const fromCache = findToolByBaseName(cached, HA_CONTEXT_TOOL)?.rawName
	if (fromCache) {
		contextToolNames.set(providerId, fromCache)
		return fromCache
	}
	try {
		const listed = await handle.listTools()
		const live = listed.tools.find(
			(t) => toolBaseName(t.name) === HA_CONTEXT_TOOL,
		)?.name
		if (live) {
			contextToolNames.set(providerId, live)
			return live
		}
	} catch (err) {
		skillEngineLogger.warn("ha context tool lookup failed", { providerId, err })
	}
	return HA_CONTEXT_TOOL
}

const refreshContext = async (
	providerId: string,
	handle: SkillConnHandleType,
	cached: readonly { rawName: string }[] = [],
): Promise<void> => {
	try {
		const contextTool = await resolveContextToolName(providerId, handle, cached)
		const res = await handle.callTool(contextTool, {})
		if (res.isError) return
		let body = res.text
		const { value: parsed } = parseLlmJson<{ result?: string }>(res.text)
		if (parsed && typeof parsed.result === "string") body = parsed.result
		const entities = parseLiveContext(body)
		if (entities.length === 0) return
		const areas = new Set(
			entities
				.map((e) => e.area)
				.filter((a): a is string => !!a)
				.map((a) => fold(a)),
		)
		contextCache.set(providerId, {
			entities,
			areas,
			fetchedAt: Date.now(),
			handle,
		})
		skillEngineLogger.info(
			`🏠 HA context cached: ${entities.length} entities, ${areas.size} areas`,
		)
	} catch (err) {
		skillEngineLogger.warn("HA context refresh failed", { err })
	}
}

const contextFor = (providerId: string): HaContextCacheType | null => {
	const live = snapshotContext(providerId)
	if (live) return live
	const cached = contextCache.get(providerId)
	if (!cached) return null
	if (Date.now() - cached.fetchedAt > HA_CONTEXT_TTL_MS) {
		cached.fetchedAt = Date.now()
		void refreshContext(providerId, cached.handle)
	}
	return cached
}

const nameScore = (
	query: string,
	candidate: string,
	generic: Set<string>,
): number => {
	const qAll = tokensOf(query)
	const qSignal = qAll.filter((t) => !generic.has(t))
	const useSignal = qSignal.length > 0
	const q = new Set(useSignal ? qSignal : qAll)
	const cAll = tokensOf(candidate)
	const cSignal = cAll.filter((t) => !generic.has(t))
	const c = useSignal && cSignal.length > 0 ? cSignal : cAll
	if (q.size === 0 || c.length === 0) return 0
	let hits = 0
	for (const token of c) {
		for (const qt of q) {
			if (token === qt || token.startsWith(qt) || qt.startsWith(token)) {
				hits++
				break
			}
		}
	}
	if (!useSignal) return Math.min(1, hits / q.size)
	let covered = 0
	for (const qt of q) {
		for (const token of c) {
			if (token === qt || token.startsWith(qt) || qt.startsWith(token)) {
				covered++
				break
			}
		}
	}
	const ratio = hits / Math.max(q.size, c.length)
	return covered === q.size ? Math.max(ratio, HA_FULL_COVERAGE_SCORE) : ratio
}

const stripTokens = (candidate: string, drop: Set<string>): string =>
	tokensOf(candidate)
		.filter((t) => !drop.has(t))
		.join(" ")

const bestEntityIn = (
	entities: HaEntityType[],
	query: string,
	generic: Set<string>,
	areaTokens: Set<string> | null,
): HaEntityType | null => {
	const folded = fold(query)
	let best: { entity: HaEntityType; score: number } | null = null
	let tied = false
	for (const entity of entities) {
		let entityScore = 0
		for (const candidate of entity.names) {
			const stripped = areaTokens ? stripTokens(candidate, areaTokens) : null
			const score =
				fold(candidate) === folded || (stripped && fold(stripped) === folded)
					? 1
					: Math.max(
							nameScore(query, candidate, generic),
							stripped ? nameScore(query, stripped, generic) : 0,
							entity.area
								? nameScore(query, `${candidate} ${entity.area}`, generic)
								: 0,
						)
			entityScore = Math.max(entityScore, score)
		}
		if (entityScore > (best?.score ?? 0)) {
			best = { entity, score: entityScore }
			tied = false
		} else if (entityScore === best?.score && entityScore > 0) {
			tied = true
		}
	}
	if (!best || best.score < HA_NAME_MATCH_MIN || tied) return null
	return best.entity
}

const resolveEntity = (
	ctx: HaContextCacheType,
	query: string,
	areaHint: string | null,
	generic: Set<string>,
): HaEntityType | null => {
	const foldedArea = areaHint ? fold(areaHint) : null
	if (areaHint && foldedArea && ctx.areas.has(foldedArea)) {
		const within = ctx.entities.filter(
			(e) => e.area && fold(e.area) === foldedArea,
		)
		return bestEntityIn(within, query, generic, new Set(tokensOf(areaHint)))
	}
	return bestEntityIn(ctx.entities, query, generic, null)
}

const fuzzyArea = (ctx: HaContextCacheType, query: string): string | null => {
	const q = new Set(tokensOf(query))
	let best: { area: string; hits: number } | null = null
	let tied = false
	for (const area of ctx.areas) {
		let hits = 0
		for (const token of tokensOf(area)) if (q.has(token)) hits++
		if (hits > (best?.hits ?? 0)) {
			best = { area, hits }
			tied = false
		} else if (hits === best?.hits && hits > 0) {
			tied = true
		}
	}
	return best && !tied ? best.area : null
}

const canonicalArea = (
	ctx: HaContextCacheType,
	query: string,
): string | null => (ctx.areas.has(fold(query)) ? query : null)

const echoesName = (value: string, name: string): boolean => {
	if (value.toLowerCase() === name.toLowerCase()) return true
	const nameTokens = new Set(tokensOf(name))
	const valueTokens = tokensOf(value)
	return valueTokens.length > 0 && valueTokens.every((t) => nameTokens.has(t))
}

const invocationTarget = (args: Record<string, unknown>): string | null => {
	for (const key of ["name", "area"]) {
		const value = args[key]
		if (typeof value === "string" && value.trim()) return value.trim()
	}
	return null
}

const foldedEntitiesOf = (
	ctx: HaContextCacheType,
): Map<string, HaEntityType> => {
	if (ctx.foldedByName) return ctx.foldedByName
	const map = new Map<string, HaEntityType>()
	for (const e of ctx.entities)
		for (const n of e.names) {
			const f = fold(n)
			if (!map.has(f)) map.set(f, e)
		}
	ctx.foldedByName = map
	return ctx.foldedByName
}

const entityNamesFor = (providerId: string, target: string): string[] => {
	const ctx = contextCache.get(providerId)
	if (!ctx) return [target]
	const entity = foldedEntitiesOf(ctx).get(fold(target))
	return entity ? [...entity.names] : [target]
}

const haFinalizeTemplates = (language: string | null): ToolFinalizeMapType => {
	const phrases = languageSetsFor(language).phrases
	return {
		HassTurnOn: {
			mode: "deadline",
			ack: phrases.onIt,
			done: phrases.turnedOn,
			error: phrases.cantDoThat,
		},
		HassTurnOff: {
			mode: "deadline",
			ack: phrases.onIt,
			done: phrases.turnedOff,
			error: phrases.cantDoThat,
		},
		HassLightSet: {
			mode: "deadline",
			ack: phrases.onIt,
			done: phrases.adjusted,
			error: phrases.cantAdjust,
		},
	}
}

const haToolHints = (
	tools: SkillToolType[],
): Record<string, ToolHintOverrideType> => {
	const hints: Record<string, ToolHintOverrideType> = {}
	for (const t of tools) {
		if (HA_READ_TOOL_RE.test(toolBaseName(t.rawName)))
			hints[t.rawName] = { readOnlyHint: true, openWorldHint: false }
		else
			hints[t.rawName] = {
				readOnlyHint: false,
				destructiveHint: HA_SENSITIVE_TOOL_RE.test(toolBaseName(t.rawName)),
				idempotentHint: true,
				openWorldHint: false,
			}
	}
	return hints
}

const haToolPolicy = (tools: SkillToolType[]): Record<string, "confirm"> => {
	const policy: Record<string, "confirm"> = {}
	for (const t of tools)
		if (HA_SENSITIVE_TOOL_RE.test(toolBaseName(t.rawName)))
			policy[t.rawName] = "confirm"
	return policy
}

const resolvedEntityDomain = (
	provider: SelectSkillProviderType,
	resolvedArgs: Record<string, unknown>,
): string | null => {
	const name =
		typeof resolvedArgs.name === "string" ? resolvedArgs.name.trim() : null
	if (!name) return null
	const ctx = contextCache.get(provider.id)
	if (!ctx) return null
	const entity = foldedEntitiesOf(ctx).get(fold(name))
	return entity?.domain ?? null
}

const baseLanguage = (language: string | null): string =>
	(language ?? "en").toLowerCase().split(/[-_]/)[0]

const forLanguage = <T>(
	byLanguage: Record<string, T>,
	language: string | null,
): T => byLanguage[baseLanguage(language)] ?? byLanguage.en

const haFastPathBlock = (
	tools: SkillToolType[],
	language: string | null,
): FastPathBlockType | undefined => {
	const turnOn = findToolByBaseName(tools, "HassTurnOn")?.rawName
	const turnOff = findToolByBaseName(tools, "HassTurnOff")?.rawName
	const lightSet = findToolByBaseName(tools, "HassLightSet")?.rawName
	const pack = forLanguage(HA_FAST_PATH_LANGUAGES, language)
	const intents: FastPathIntentType[] = []
	const entitySlot = {
		entity: { source: { kind: "context", key: "entity" } },
	} as FastPathIntentType["slots"]
	const areaSlot = {
		area: { source: { kind: "context", key: "area" } },
	} as FastPathIntentType["slots"]
	if (turnOn)
		intents.push({
			tool: turnOn,
			templates: pack.turnOnTemplates,
			slots: entitySlot,
			requiredKeywords: pack.turnOnKeywords,
		})
	if (turnOn && pack.turnOnAreaTemplates.length > 0)
		intents.push({
			tool: turnOn,
			templates: pack.turnOnAreaTemplates,
			slots: areaSlot,
			requiredKeywords: pack.turnOnKeywords,
			argDefaults: { domain: ["light"] },
		})
	if (turnOff)
		intents.push({
			tool: turnOff,
			templates: pack.turnOffTemplates,
			slots: entitySlot,
			requiredKeywords: pack.turnOffKeywords,
		})
	if (turnOff && pack.turnOffAreaTemplates.length > 0)
		intents.push({
			tool: turnOff,
			templates: pack.turnOffAreaTemplates,
			slots: areaSlot,
			requiredKeywords: pack.turnOffKeywords,
			argDefaults: { domain: ["light"] },
		})
	if (lightSet)
		intents.push({
			tool: lightSet,
			templates: pack.lightSetTemplates,
			slots: {
				...entitySlot,
				level: {
					source: { kind: "range", min: 0, max: 100 },
					arg: "brightness",
				},
			},
		})
	if (intents.length === 0) return undefined
	return {
		intents,
		expansionRules: pack.expansionRules,
	}
}

export const homeAssistantSpecialization: SkillSpecializationType = {
	kind: HA_SPECIALIZATION_KIND,
	catalogExtensions: HA_CATALOG_EXTENSIONS,
	descriptorDefaults: (tools, language) => ({
		version: 1,
		kind: HA_SPECIALIZATION_KIND,
		routing: {
			aliases: HA_ALIASES,
			exampleUtterances: forLanguage(HA_EXAMPLE_UTTERANCES, language),
		},
		execution: {
			coreTools: tools
				.filter(
					(t) =>
						toolBaseName(t.rawName) === HA_CONTEXT_TOOL ||
						HA_CORE_RE.test(toolBaseName(t.rawName)) ||
						HA_CORE_RE.test(t.description ?? ""),
				)
				.map((t) => t.rawName),
			toolHints: haToolHints(tools),
			toolPolicy: haToolPolicy(tools),
			finalize: haFinalizeTemplates(language),
			genericWords: [...languageSetsFor(language).genericWords],
		},
		fastPath: haFastPathBlock(tools, language),
	}),
	status: (provider) => dataPlaneStatus(provider.id),
	discover: async (timeoutMs) =>
		(await browseService(HA_MDNS_SERVICE_TYPE, timeoutMs)).map((service) => {
			const base =
				service.txt.base_url ??
				service.txt.internal_url ??
				`http://${service.host}:${service.port}`
			return {
				kind: HA_SPECIALIZATION_KIND,
				name: service.txt.location_name ?? service.name,
				url: `${base.replace(/\/$/, "")}${HA_MCP_PATH}`,
				host: service.host,
				port: service.port,
				version: service.txt.version ?? null,
			}
		}),
	describeInvocation: (provider, rawName, args, language) => {
		const target = invocationTarget(args)
		if (!target) return null
		const verb = forLanguage(HA_ACTION_VERBS, language)[toolBaseName(rawName)]
		const targetNames = entityNamesFor(provider.id, target)
		return {
			target,
			targetNames,
			...(verb ? { summary: `${verb} ${target}` } : {}),
		}
	},
	fastPathSlotValues: (provider, key) => {
		const ctx = contextCache.get(provider.id)
		if (!ctx) return null
		if (key === "entity") {
			const out: { phrase: string; args: Record<string, unknown> }[] = []
			for (const entity of ctx.entities) {
				const canonical = entity.names[0]
				if (!canonical) continue
				for (const name of entity.names)
					out.push({ phrase: name, args: { name: canonical } })
			}
			return out
		}
		if (key === "area")
			return [...ctx.areas].map((area) => ({ phrase: area, args: { area } }))
		return null
	},
	invocationRisk: (provider, _rawName, resolvedArgs) => {
		const domain = resolvedEntityDomain(provider, resolvedArgs)
		if (domain && HA_SENSITIVE_DOMAIN_RE.test(domain))
			return "write_destructive"
		const domainsArg = resolvedArgs.domain
		if (
			Array.isArray(domainsArg) &&
			domainsArg.some(
				(d) => typeof d === "string" && HA_SENSITIVE_DOMAIN_RE.test(d),
			)
		)
			return "write_destructive"
		return null
	},
	onConnected: async (
		provider: SelectSkillProviderType,
		handle: SkillConnHandleType,
	) => {
		await refreshContext(provider.id, handle, provider.toolsCache ?? [])
		attachDataPlane(provider, handle)
	},
	onDisconnected: (provider: SelectSkillProviderType) => {
		detachDataPlane(provider.id)
		contextCache.delete(provider.id)
		contextToolNames.delete(provider.id)
	},
	interceptToolCall: (provider, rawName) => {
		if (toolBaseName(rawName) !== HA_CONTEXT_TOOL) return null
		const entities = liveEntities(provider.id)
		if (!entities || entities.length === 0) return null
		const lines = entities.map((e) => {
			const parts = [
				`names: ${e.names.join(", ") || e.entityId}`,
				`domain: ${e.domain}`,
				`state: ${e.state ?? "unknown"}`,
			]
			if (e.area) parts.push(`areas: ${e.area}`)
			return `- ${parts.join("; ")}`
		})
		return {
			text: `Live Context: An overview of the areas and the devices in this smart home:\n${lines.join("\n")}`,
		}
	},
	resolveArgs: (provider, _rawName, args, language) => {
		const rawName = args.name
		const name = typeof rawName === "string" ? rawName.trim() : null
		const rawArea = typeof args.area === "string" ? args.area.trim() : null
		const out: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(args)) {
			let v = typeof value === "string" ? value.trim() : value
			if (typeof v === "string" && v.startsWith("[")) {
				try {
					const parsed = JSON.parse(v) as unknown
					if (Array.isArray(parsed)) v = parsed
				} catch {
					/* not json */
				}
			}
			if (
				typeof v === "string" &&
				(v.length === 0 || HA_PLACEHOLDER_RE.test(v))
			)
				continue
			if (v !== null && typeof v === "object" && !Array.isArray(v)) continue
			if (Array.isArray(v)) {
				const kept = v.filter(
					(item) =>
						typeof item !== "string" ||
						(item.trim().length > 0 && !HA_PLACEHOLDER_RE.test(item)),
				)
				if (kept.length === 0) continue
				out[key] = kept
				continue
			}
			if (
				key === "area" &&
				typeof v === "string" &&
				name &&
				echoesName(v, name)
			)
				continue
			if (
				key === "floor" &&
				typeof v === "string" &&
				echoesName(v, [name, rawArea].filter(Boolean).join(" "))
			)
				continue
			if (
				(key === "domain" || key === "device_class") &&
				typeof v === "string"
			) {
				out[key] = [v]
				continue
			}
			if (
				key !== "name" &&
				key !== "area" &&
				typeof v === "string" &&
				/^-?\d+(\.\d+)?$/.test(v)
			) {
				out[key] = Number(v)
				continue
			}
			out[key] = v
		}

		const ctx = contextFor(provider.id)
		if (ctx) {
			if (Array.isArray(out.device_class)) {
				const domains = new Set(
					ctx.entities.map((e) => e.domain).filter(Boolean),
				)
				const misplaced = out.device_class.filter(
					(d): d is string => typeof d === "string" && domains.has(d),
				)
				if (misplaced.length > 0) {
					const kept = out.device_class.filter(
						(d) => !(typeof d === "string" && domains.has(d)),
					)
					skillEngineLogger.info(
						`🏠 device_class ${JSON.stringify(misplaced)} → domain`,
					)
					if (kept.length > 0) out.device_class = kept
					else delete out.device_class
					const domain: unknown[] = Array.isArray(out.domain) ? out.domain : []
					out.domain = [...new Set([...domain, ...misplaced])]
				}
			}
			if (typeof out.floor === "string") {
				const mapped =
					canonicalArea(ctx, out.floor) ?? fuzzyArea(ctx, out.floor)
				if (mapped && typeof out.area !== "string") {
					skillEngineLogger.info(`🏠 floor "${out.floor}" → area "${mapped}"`)
					out.area = mapped
				} else {
					skillEngineLogger.info(`🏠 floor "${out.floor}" dropped`)
				}
				delete out.floor
			}
			let areaHint: string | null =
				typeof out.area === "string" ? out.area : null
			if (areaHint && !canonicalArea(ctx, areaHint)) {
				const mapped = fuzzyArea(ctx, areaHint)
				skillEngineLogger.info(
					`🏠 unknown area "${areaHint}" → ${mapped ? `"${mapped}"` : "dropped"}`,
				)
				areaHint = mapped
				const rest = Object.fromEntries(
					Object.entries(out).filter(([k]) => k !== "area"),
				)
				if (mapped) rest.area = mapped
				return finalizeNames(
					ctx,
					rest,
					areaHint,
					genericWordsFor(provider, language ?? null),
				)
			}
			return finalizeNames(
				ctx,
				out,
				areaHint,
				genericWordsFor(provider, language ?? null),
			)
		}
		if (typeof out.name === "string") {
			throw domiaError(SKILL_ERRORS.PROVIDER_NOT_READY, {
				logger: skillEngineLogger,
				meta: {
					provider: provider.id,
					name: out.name,
					reason: "HA entity context not ready — failing closed",
				},
			})
		}
		return out
	},
}

const finalizeNames = (
	ctx: HaContextCacheType,
	args: Record<string, unknown>,
	areaHint: string | null,
	generic: Set<string>,
): Record<string, unknown> => {
	if (typeof args.name !== "string") return args
	const resolved = resolveEntity(ctx, args.name, areaHint, generic)
	if (!resolved) return args
	const out = { ...args }
	const canonical = resolved.names[0] ?? args.name
	if (canonical !== args.name) {
		skillEngineLogger.info(`🏠 entity "${args.name}" → "${canonical}"`)
		out.name = canonical
	}
	if (typeof out.area === "string") {
		if (!resolved.area) {
			skillEngineLogger.info(
				`🏠 area "${out.area}" dropped (entity has no area)`,
			)
			delete out.area
		} else if (fold(out.area) !== fold(resolved.area)) {
			skillEngineLogger.info(`🏠 area "${out.area}" → "${resolved.area}"`)
			out.area = resolved.area
		} else {
			out.area = resolved.area
		}
	}
	return out
}
