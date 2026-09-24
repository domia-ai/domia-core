import { browseService } from "@/modules/satellite-discovery"
import type {
	SelectSkillProviderType,
	ToolFinalizeMapType,
	SkillToolType,
	ToolHintOverrideType,
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
import { bindFastPathTools } from "../../utils/descriptor-data"
import {
	mediaOwnedNames,
	setDeviceOwnerNames,
	clearDeviceOwner,
} from "../../utils/media-owners"
import { findToolByBaseName, toolBaseName } from "../../utils/tool-name"
import { bestByName, stripTokens } from "../../utils/name-match"
import type { HaEntityType, HaContextCacheType, HaSlotValueType } from "./types"
import {
	HA_SPECIALIZATION_KIND,
	HA_ALIASES,
	HA_CORE_RE,
	HA_PLACEHOLDER_RE,
	HA_CONTEXT_TTL_MS,
	HA_CONTEXT_TOOL,
	HA_EXPLICIT_TARGET_ARGS,
	HA_ARG_DOMAIN,
	HA_NAME_MATCH_MIN,
	HA_FULL_COVERAGE_SCORE,
	HA_SENSITIVE_TOOL_RE,
	HA_BUILTIN_SHADOWED_TOOLS,
	HA_FAST_PATH_EXCLUDED_DOMAINS,
	HA_SENSITIVE_DOMAIN_RE,
	HA_READ_TOOL_RE,
	HA_ACTION_VERBS,
	HA_CATALOG_EXTENSIONS,
	HA_FAST_PATH_PACKS,
	HA_FAST_PATH_AREA_KEY,
	HA_FAST_PATH_ENTITY_DOMAIN_SEPARATOR,
	HA_FAST_PATH_ENTITY_KEY,
	HA_FAST_PATH_ENTITY_KEY_PREFIX,
	HA_FAST_PATH_FLOOR_KEY,
	HA_FAST_PATH_NAME_GROUPS,
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
	namesByFolded,
} from "./data-plane"

const genericWordsFor = (
	provider: SelectSkillProviderType,
	language: string | null,
): Set<string> =>
	new Set(
		resolveDescriptor(provider, language).genericWords.map((w) => fold(w)),
	)

const contextCache = new Map<string, HaContextCacheType>()
const providerDomiaIds = new Map<string, string>()

const registerDeviceNames = (
	providerId: string,
	entities: readonly HaEntityType[],
): void => {
	const domiaId = providerDomiaIds.get(providerId)
	if (!domiaId) return
	setDeviceOwnerNames(
		domiaId,
		providerId,
		entities.flatMap((e) => e.names),
	)
}

const parseLiveContext = (text: string): HaEntityType[] => {
	const entities: HaEntityType[] = []
	let current: HaEntityType | null = null
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
				floor: null,
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
		const areaNames = namesByFolded(entities.map((e) => e.area))
		registerDeviceNames(providerId, entities)
		contextCache.set(providerId, {
			entities,
			areas: new Set(areaNames.keys()),
			areaNames,
			floorNames: new Map(),
			slotValuesByKey: new Map(),
			fetchedAt: Date.now(),
			handle,
		})
		skillEngineLogger.info(
			`🏠 HA context cached: ${entities.length} entities, ${areaNames.size} areas`,
		)
	} catch (err) {
		skillEngineLogger.warn("HA context refresh failed", { err })
	}
}

const registeredSnapshots = new WeakSet<HaContextCacheType>()

const contextFor = (providerId: string): HaContextCacheType | null => {
	const live = snapshotContext(providerId)
	if (live) {
		if (!registeredSnapshots.has(live)) {
			registeredSnapshots.add(live)
			registerDeviceNames(providerId, live.entities)
		}
		return live
	}
	const cached = contextCache.get(providerId)
	if (!cached) return null
	if (Date.now() - cached.fetchedAt > HA_CONTEXT_TTL_MS) {
		cached.fetchedAt = Date.now()
		void refreshContext(providerId, cached.handle)
	}
	return cached
}

const entityNameVariants = (
	entity: HaEntityType,
	areaTokens: Set<string> | null,
): string[] =>
	entity.names.flatMap((candidate) => [
		candidate,
		...(areaTokens ? [stripTokens(candidate, areaTokens)] : []),
		...(entity.area ? [`${candidate} ${entity.area}`] : []),
	])

const bestEntityIn = (
	entities: HaEntityType[],
	query: string,
	generic: Set<string>,
	areaTokens: Set<string> | null,
): HaEntityType | null =>
	bestByName(
		entities,
		(entity) => entityNameVariants(entity, areaTokens),
		query,
		generic,
		HA_NAME_MATCH_MIN,
		HA_FULL_COVERAGE_SCORE,
	)

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

const hasExplicitTargetArg = (args: Record<string, unknown>): boolean =>
	HA_EXPLICIT_TARGET_ARGS.some((key) => {
		const value = args[key]
		if (typeof value === "string") return value.trim().length > 0
		return Array.isArray(value) && value.length > 0
	})

const domainArgOf = (args: Record<string, unknown>): string[] => {
	const value = args[HA_ARG_DOMAIN]
	const list = Array.isArray(value) ? value : [value]
	return list.filter(
		(d): d is string => typeof d === "string" && d.trim().length > 0,
	)
}

const phraseInTokens = (tokens: string[], phrase: string): boolean => {
	const parts = tokensOf(phrase)
	if (parts.length === 0) return false
	return tokens.some((_, i) => parts.every((p, k) => tokens[i + k] === p))
}

const domainsSpokenIn = (tokens: string[], language: string | null): string[] =>
	Object.entries(languageSetsFor(language).domainWords)
		.filter(([, words]) => words.some((w) => phraseInTokens(tokens, w)))
		.map(([domain]) => domain)

const actionableDomainsOf = (providerId: string): string[] => {
	const ctx = contextFor(providerId)
	if (!ctx) return []
	return [
		...new Set(
			ctx.entities
				.map((e) => e.domain)
				.filter((d) => d.length > 0 && !HA_SENSITIVE_DOMAIN_RE.test(d)),
		),
	]
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

const haToolPolicy = (
	tools: SkillToolType[],
): Record<string, "confirm" | "block"> => {
	const policy: Record<string, "confirm" | "block"> = {}
	for (const t of tools) {
		const base = toolBaseName(t.rawName)
		if (HA_BUILTIN_SHADOWED_TOOLS.has(base)) policy[t.rawName] = "block"
		else if (HA_SENSITIVE_TOOL_RE.test(base)) policy[t.rawName] = "confirm"
	}
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
		fastPath: bindFastPathTools(
			forLanguage(HA_FAST_PATH_PACKS, language),
			tools.filter(
				(t) => !HA_BUILTIN_SHADOWED_TOOLS.has(toolBaseName(t.rawName)),
			),
		),
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
	inferWriteTarget: (provider, _rawName, args, transcript, language) => {
		if (hasExplicitTargetArg(args)) return { kind: "targeted" }
		const tokens = tokensOf(transcript)
		const spoken = domainsSpokenIn(tokens, language)
		const domainArg = domainArgOf(args)
		if (domainArg.length > 0 && domainArg.every((d) => spoken.includes(d)))
			return { kind: "targeted" }
		if (domainArg.length > 0)
			skillEngineLogger.warn(
				`🏠 domain ${JSON.stringify(domainArg)} was not spoken — ignoring it`,
			)
		if (spoken.length > 0) {
			skillEngineLogger.info(
				`🏠 targetless write → domain ${JSON.stringify(spoken)}`,
			)
			return { kind: "inferred", args: { domain: spoken } }
		}
		const blanket = languageSetsFor(language).allCues.some((cue) =>
			phraseInTokens(tokens, cue),
		)
		const actionable = blanket ? actionableDomainsOf(provider.id) : []
		if (actionable.length > 0) {
			skillEngineLogger.info(
				`🏠 blanket write → domain ${JSON.stringify(actionable)}`,
			)
			return { kind: "inferred", args: { domain: actionable } }
		}
		return { kind: "untargeted" }
	},
	fastPathSlotValues: (provider, key) => {
		const ctx = contextFor(provider.id)
		if (!ctx) return null
		const owned = mediaOwnedNames(provider.domiaId)
		const cacheKey = `${key}|${owned.version}`
		const cached = ctx.slotValuesByKey.get(cacheKey)
		if (cached !== undefined) return cached
		const values = slotValuesOf(ctx, key, owned.folded)
		ctx.slotValuesByKey.set(cacheKey, values)
		return values
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
		providerDomiaIds.set(provider.id, provider.domiaId)
		await refreshContext(provider.id, handle, provider.toolsCache ?? [])
		attachDataPlane(provider, handle)
	},
	onDisconnected: (provider: SelectSkillProviderType) => {
		detachDataPlane(provider.id)
		clearDeviceOwner(provider.domiaId, provider.id)
		providerDomiaIds.delete(provider.id)
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

const entityKeyDomains = (key: string): Set<string> | null | undefined => {
	if (key === HA_FAST_PATH_ENTITY_KEY) return null
	if (!key.startsWith(HA_FAST_PATH_ENTITY_KEY_PREFIX)) return undefined
	const spec = key.slice(HA_FAST_PATH_ENTITY_KEY_PREFIX.length)
	const domains = spec
		.split(HA_FAST_PATH_ENTITY_DOMAIN_SEPARATOR)
		.flatMap((d) => HA_FAST_PATH_NAME_GROUPS[d] ?? [d])
		.map((d) => d.trim())
		.filter((d) => d.length > 0)
	return domains.length > 0 ? new Set(domains) : undefined
}

const ownedByMedia = (entity: HaEntityType, owned: Set<string>): boolean =>
	owned.size > 0 && entity.names.some((n) => owned.has(fold(n)))

const entitySlotValues = (
	ctx: HaContextCacheType,
	domains: Set<string> | null,
	owned: Set<string>,
): HaSlotValueType[] | null => {
	const out: HaSlotValueType[] = []
	for (const entity of ctx.entities) {
		const canonical = entity.names[0]
		if (!canonical) continue
		if (domains && !domains.has(entity.domain)) continue
		if (HA_FAST_PATH_EXCLUDED_DOMAINS.has(entity.domain)) continue
		if (ownedByMedia(entity, owned)) continue
		for (const name of entity.names)
			out.push({ phrase: name, args: { name: canonical } })
	}
	return out.length > 0 ? out : null
}

const namedSlotValues = (
	names: Map<string, string>,
	arg: string,
): HaSlotValueType[] | null =>
	names.size > 0
		? [...names.values()].map((name) => ({
				phrase: name,
				args: { [arg]: name },
			}))
		: null

const slotValuesOf = (
	ctx: HaContextCacheType,
	key: string,
	owned: Set<string>,
): HaSlotValueType[] | null => {
	if (key === HA_FAST_PATH_AREA_KEY)
		return namedSlotValues(ctx.areaNames, HA_FAST_PATH_AREA_KEY)
	if (key === HA_FAST_PATH_FLOOR_KEY)
		return namedSlotValues(ctx.floorNames, HA_FAST_PATH_FLOOR_KEY)
	const domains = entityKeyDomains(key)
	if (domains === undefined) return null
	return entitySlotValues(ctx, domains, owned)
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
