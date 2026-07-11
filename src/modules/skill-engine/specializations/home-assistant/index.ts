import type { SelectSkillProviderType, ToolFinalizeMapType } from "@/db"
import { skillEngineLogger, languageSetsFor, parseLlmJson } from "@/utils"

import type {
	SkillSpecializationType,
	SkillConnHandleType,
	HaEntityType,
	HaContextCacheType,
} from "../../types"
import { resolveDescriptor } from "../../utils/descriptor"
import { fold, tokensOf } from "./text"
import { attachDataPlane, detachDataPlane, snapshotContext } from "./data-plane"

const HA_ALIASES: Record<string, string[]> = {
	brighter: ["brightness", "light", "bright"],
	dimmer: ["dim", "light", "brightness"],
	dim: ["light", "brightness"],
	lights: ["light"],
	lamp: ["light"],
	warmer: ["temperature", "warm", "heat", "climate"],
	cooler: ["temperature", "cool", "climate"],
	colder: ["temperature", "cold", "climate"],
	degrees: ["temperature", "climate"],
	thermostat: ["temperature", "climate"],
	ac: ["climate", "temperature", "cool"],
	heating: ["climate", "temperature", "heat"],
	blinds: ["cover"],
	curtains: ["cover"],
	shades: ["cover"],
	shutters: ["cover"],
}

const CORE_RE =
	/turn.?on|turn.?off|light.?set|set.?temp|climate|cover|hass(turnon|turnoff|lightset)/i

const PLACEHOLDER_RE = /^(\[\]|\{\}|null|none|n\/a|undefined)$/i

const CONTEXT_TTL_MS = 5 * 60 * 1000
const CONTEXT_TOOL = "GetLiveContext"
const NAME_MATCH_MIN = 0.5
const FULL_COVERAGE_SCORE = 0.75

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
		const namesMatch = line.match(/^- names:\s*(.*)$/)
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
		const cont = line.match(/^\s{4}(\S.*)$/)
		if (cont && !line.includes(":")) {
			current.names.push(
				...cont[1]
					.split(",")
					.map((n) => n.trim())
					.filter(Boolean),
			)
			continue
		}
		const domainMatch = line.match(/^\s+domain:\s*(\S+)/)
		if (domainMatch) current.domain = domainMatch[1]
		const areaMatch = line.match(/^\s+areas:\s*(.+)$/)
		if (areaMatch) current.area = areaMatch[1].trim()
	}
	if (current) entities.push(current)
	return entities
}

const refreshContext = async (
	providerId: string,
	handle: SkillConnHandleType,
): Promise<void> => {
	try {
		const res = await handle.callTool(CONTEXT_TOOL, {})
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
	if (Date.now() - cached.fetchedAt > CONTEXT_TTL_MS) {
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
	return covered === q.size ? Math.max(ratio, FULL_COVERAGE_SCORE) : ratio
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
		} else if (best && entityScore === best.score && entityScore > 0) {
			tied = true
		}
	}
	if (!best || best.score < NAME_MATCH_MIN || tied) return null
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
		} else if (best && hits === best.hits && hits > 0) {
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

export const homeAssistantSpecialization: SkillSpecializationType = {
	kind: "home-assistant",
	descriptorDefaults: (tools, language) => ({
		version: 1,
		kind: "home-assistant",
		routing: { aliases: HA_ALIASES },
		execution: {
			coreTools: tools
				.filter(
					(t) => CORE_RE.test(t.rawName) || CORE_RE.test(t.description ?? ""),
				)
				.map((t) => t.rawName),
			finalize: haFinalizeTemplates(language),
			genericWords: [...languageSetsFor(language).deviceGenericWords],
		},
	}),
	onConnected: async (
		provider: SelectSkillProviderType,
		handle: SkillConnHandleType,
	) => {
		await refreshContext(provider.id, handle)
		attachDataPlane(provider, handle)
	},
	onDisconnected: (provider: SelectSkillProviderType) => {
		detachDataPlane(provider.id)
		contextCache.delete(provider.id)
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
			if (typeof v === "string" && (v.length === 0 || PLACEHOLDER_RE.test(v)))
				continue
			if (v !== null && typeof v === "object" && !Array.isArray(v)) continue
			if (Array.isArray(v)) {
				const kept = v.filter(
					(item) =>
						typeof item !== "string" ||
						(item.trim().length > 0 && !PLACEHOLDER_RE.test(item)),
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
					const domain = Array.isArray(out.domain) ? out.domain : []
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
			skillEngineLogger.warn(
				"HA entity context not ready — failing closed rather than mis-target",
				{ provider: provider.id, name: out.name },
			)
			throw new Error("device list not ready yet")
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
