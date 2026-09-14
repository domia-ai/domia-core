import type {
	FastPathBlockType,
	FastPathIntentType,
	SelectSkillProviderType,
	SkillToolType,
	ToolFinalizeMapType,
} from "@/db"
import { getTraceContext, languageSetsFor, skillEngineLogger } from "@/utils"

import type {
	SkillCallResultType,
	SkillSpecializationType,
	ToolInvocationDescriptionType,
	ToolTargetInferenceType,
} from "../../types"
import { SPEAKABLE_PLACEHOLDER } from "../../utils/finalize-render"
import {
	MA_ACTION_VERBS,
	MA_ALIASES,
	MA_ARG_LEVEL,
	MA_ARG_MUTED,
	MA_ARG_NORMALIZE,
	MA_ARG_PLAYER,
	MA_ARG_PLAYER_ID,
	MA_ARG_QUEUE_ID,
	MA_CATALOG_EXTENSIONS,
	MA_EXAMPLE_UTTERANCES,
	MA_FAST_PATH_LANGUAGES,
	MA_KEYWORDS,
	MA_PARAM_ALLOW,
	MA_PLACEHOLDER_RE,
	MA_QUEUE_ARG_TOOLS,
	MA_SLOT_LEVEL,
	MA_SLOT_PLAYER,
	MA_SLOT_PLAYER_QUEUE,
	MA_SPECIALIZATION_KIND,
	MA_TEXT_ARGS,
	MA_TOOL_HINTS,
	MA_TOOL_MUSIC_PLAY,
	MA_TOOL_NEXT,
	MA_TOOL_NOW_PLAYING,
	MA_TOOL_PAUSE,
	MA_TOOL_PREVIOUS,
	MA_TOOL_RESUME,
	MA_TOOL_VOLUME_DOWN,
	MA_TOOL_VOLUME_MUTE,
	MA_TOOL_VOLUME_SET,
	MA_TOOL_VOLUME_UP,
	MA_VIRTUAL_TOOLS,
	MA_VOLUME_MAX,
	MA_VOLUME_MIN,
} from "./constants"
import { implicitPlayer, matchPlayer, queueTargetOf } from "./planner"
import {
	forgetSatellitePlayers,
	genericWordsOf,
	knownSatellitePlayerName,
	playerAliasesOf,
	playerRoster,
	resolvePlayer,
	rosterStatus,
	rosterTtlMsOf,
} from "./roster"
import { callMaVirtualTool, maVirtualTools } from "./virtual-tools"
import { forgetPreMuteLevels } from "./volume"
import type { MaPlayerType } from "./types"

const baseLanguage = (language: string | null): string =>
	(language ?? "en").toLowerCase().split(/[-_]/)[0]

const forLanguage = <T>(
	byLanguage: Record<string, T>,
	language: string | null,
): T => byLanguage[baseLanguage(language)] ?? byLanguage.en

const mergedWithEn = (
	byLanguage: Record<string, string[]>,
	language: string | null,
): string[] => [
	...new Set([...byLanguage.en, ...(byLanguage[baseLanguage(language)] ?? [])]),
]

const playerArgOf = (rawName: string): string =>
	MA_QUEUE_ARG_TOOLS.includes(rawName) ? MA_ARG_QUEUE_ID : MA_ARG_PLAYER_ID

const isVirtual = (rawName: string): boolean =>
	MA_VIRTUAL_TOOLS.includes(rawName)

const playerTargetOf = (rawName: string, player: MaPlayerType): string =>
	MA_QUEUE_ARG_TOOLS.includes(rawName) ? queueTargetOf(player) : player.playerId

const filledArg = (args: Record<string, unknown>, key: string): boolean =>
	typeof cleanValue(key, args[key]) === "string"

const isDefaultPlayer = (
	provider: SelectSkillProviderType,
	spoken: string,
	language: string | null,
): boolean => {
	const players = playerRoster.snapshot(provider.id, rosterTtlMsOf(provider))
	if (players.length === 0) return false
	const generic = genericWordsOf(provider, language)
	const named = matchPlayer(players, spoken, generic, playerAliasesOf(provider))
	if (!named) return false
	const preferred = knownSatellitePlayerName(provider)
	const fallback = preferred
		? matchPlayer(players, preferred, generic)
		: implicitPlayer(players)
	return fallback?.playerId === named.playerId
}

const withoutSpokenPlayer = (
	args: Record<string, unknown>,
): Record<string, unknown> =>
	Object.fromEntries(
		Object.entries(args).filter(([key]) => key !== MA_ARG_PLAYER),
	)

const maFinalizeTemplates = (language: string | null): ToolFinalizeMapType => {
	const phrases = languageSetsFor(language).phrases
	const control = (ack: string): ToolFinalizeMapType[string] => ({
		mode: "template",
		ack,
		error: phrases.cantDoThat,
	})
	return {
		[MA_TOOL_MUSIC_PLAY]: {
			mode: "deadline",
			ack: phrases.onIt,
			done: SPEAKABLE_PLACEHOLDER,
			error: SPEAKABLE_PLACEHOLDER,
		},
		[MA_TOOL_NOW_PLAYING]: {
			mode: "template",
			ack: SPEAKABLE_PLACEHOLDER,
			error: phrases.cantDoThat,
		},
		[MA_TOOL_PAUSE]: control(phrases.musicPaused),
		[MA_TOOL_RESUME]: control(phrases.musicResumed),
		[MA_TOOL_NEXT]: control(phrases.musicSkipped),
		[MA_TOOL_PREVIOUS]: control(phrases.musicPrevious),
		[MA_TOOL_VOLUME_SET]: control(phrases.musicVolumeSet),
		[MA_TOOL_VOLUME_UP]: control(phrases.musicVolumeUp),
		[MA_TOOL_VOLUME_DOWN]: control(phrases.musicVolumeDown),
		[MA_TOOL_VOLUME_MUTE]: {
			mode: "template",
			ack: SPEAKABLE_PLACEHOLDER,
			error: phrases.cantDoThat,
		},
	}
}

const maFastPathBlock = (
	tools: SkillToolType[],
	language: string | null,
): FastPathBlockType | undefined => {
	const available = new Set(tools.map((t) => t.rawName))
	const pack = forLanguage(MA_FAST_PATH_LANGUAGES, language)
	const queueSlot = {
		[MA_SLOT_PLAYER_QUEUE]: {
			source: { kind: "context", key: MA_SLOT_PLAYER_QUEUE },
		},
	} as FastPathIntentType["slots"]
	const playerSlot = {
		[MA_SLOT_PLAYER]: { source: { kind: "context", key: MA_SLOT_PLAYER } },
	} as FastPathIntentType["slots"]
	const candidates: FastPathIntentType[] = [
		{ tool: MA_TOOL_PAUSE, templates: pack.pauseTemplates },
		{
			tool: MA_TOOL_PAUSE,
			templates: pack.pausePlayerTemplates,
			slots: queueSlot,
		},
		{ tool: MA_TOOL_RESUME, templates: pack.resumeTemplates },
		{ tool: MA_TOOL_NEXT, templates: pack.nextTemplates },
		{
			tool: MA_TOOL_NEXT,
			templates: pack.nextPlayerTemplates,
			slots: queueSlot,
		},
		{ tool: MA_TOOL_PREVIOUS, templates: pack.previousTemplates },
		{
			tool: MA_TOOL_VOLUME_SET,
			templates: pack.volumeSetTemplates,
			slots: {
				[MA_SLOT_LEVEL]: {
					source: { kind: "range", min: MA_VOLUME_MIN, max: MA_VOLUME_MAX },
					arg: MA_ARG_LEVEL,
				},
			},
		},
		{ tool: MA_TOOL_VOLUME_UP, templates: pack.volumeUpTemplates },
		{
			tool: MA_TOOL_VOLUME_UP,
			templates: pack.volumeUpPlayerTemplates,
			slots: playerSlot,
		},
		{ tool: MA_TOOL_VOLUME_DOWN, templates: pack.volumeDownTemplates },
		{
			tool: MA_TOOL_VOLUME_DOWN,
			templates: pack.volumeDownPlayerTemplates,
			slots: playerSlot,
		},
		{
			tool: MA_TOOL_VOLUME_MUTE,
			templates: pack.muteTemplates,
			slots: playerSlot,
			argDefaults: { [MA_ARG_MUTED]: true },
		},
		{
			tool: MA_TOOL_VOLUME_MUTE,
			templates: pack.unmuteTemplates,
			slots: playerSlot,
			argDefaults: { [MA_ARG_MUTED]: false },
		},
		{ tool: MA_TOOL_NOW_PLAYING, templates: pack.nowPlayingTemplates },
	]
	const intents = candidates.filter((intent) => available.has(intent.tool))
	if (intents.length === 0) return undefined
	return { intents, expansionRules: pack.expansionRules }
}

const cleanValue = (key: string, value: unknown): unknown => {
	const trimmed = typeof value === "string" ? value.trim() : value
	if (typeof trimmed !== "string") return trimmed
	if (trimmed.length === 0 || MA_PLACEHOLDER_RE.test(trimmed)) return undefined
	if (MA_TEXT_ARGS.includes(key)) return trimmed
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
	return trimmed
}

export const musicAssistantSpecialization: SkillSpecializationType = {
	kind: MA_SPECIALIZATION_KIND,
	catalogExtensions: MA_CATALOG_EXTENSIONS,
	descriptorDefaults: (tools, language) => ({
		version: 1,
		kind: MA_SPECIALIZATION_KIND,
		routing: {
			aliases: MA_ALIASES,
			exampleUtterances: forLanguage(MA_EXAMPLE_UTTERANCES, language),
			keywords: mergedWithEn(MA_KEYWORDS, language),
		},
		execution: {
			coreTools: MA_VIRTUAL_TOOLS,
			toolHints: MA_TOOL_HINTS,
			paramAllow: MA_PARAM_ALLOW,
			argNormalize: MA_ARG_NORMALIZE,
			finalize: maFinalizeTemplates(language),
			genericWords: [...languageSetsFor(language).genericWords],
		},
		fastPath: maFastPathBlock(tools, language),
	}),
	virtualTools: () => maVirtualTools(),
	callVirtualTool: callMaVirtualTool,
	status: (provider) => rosterStatus(provider),
	onConnected: async (provider, handle) => {
		playerRoster.attach(provider.id, handle)
		await playerRoster.refresh(provider.id)
	},
	onDisconnected: (provider) => {
		playerRoster.clear(provider.id)
		forgetSatellitePlayers(provider)
		forgetPreMuteLevels(provider)
	},
	fastPathSlotValues: (provider, key, language) => {
		if (key !== MA_SLOT_PLAYER && key !== MA_SLOT_PLAYER_QUEUE) return null
		const players = playerRoster.snapshot(provider.id, rosterTtlMsOf(provider))
		if (players.length === 0) return null
		const arg =
			key === MA_SLOT_PLAYER_QUEUE ? MA_ARG_QUEUE_ID : MA_ARG_PLAYER_ID
		const argsOf = (player: MaPlayerType) => ({
			[arg]:
				key === MA_SLOT_PLAYER_QUEUE ? queueTargetOf(player) : player.playerId,
		})
		const generic = genericWordsOf(provider, language)
		const aliases = Object.entries(playerAliasesOf(provider) ?? {}).flatMap(
			([spoken, target]) => {
				const player = matchPlayer(players, target, generic)
				return player ? [{ phrase: spoken, args: argsOf(player) }] : []
			},
		)
		return [
			...players.map((player) => ({
				phrase: player.name,
				args: argsOf(player),
			})),
			...aliases,
		]
	},
	resolveArgs: async (provider, rawName, args, language) => {
		const out: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(args)) {
			const cleaned = cleanValue(key, value)
			if (cleaned !== undefined) out[key] = cleaned
		}
		const spoken =
			typeof out[MA_ARG_PLAYER] === "string" ? out[MA_ARG_PLAYER] : null
		if (!spoken) return out
		const player = await resolvePlayer(provider, spoken, language ?? null)
		if (!player) return isVirtual(rawName) ? out : withoutSpokenPlayer(out)
		skillEngineLogger.info(`🎵 speaker "${spoken}" → "${player.name}"`)
		const targeted = {
			...out,
			[playerArgOf(rawName)]: playerTargetOf(rawName, player),
		}
		return isVirtual(rawName)
			? { ...targeted, [MA_ARG_PLAYER]: player.name }
			: withoutSpokenPlayer(targeted)
	},
	preCall: async (provider, rawName, args) => {
		const withMuted =
			rawName === MA_TOOL_VOLUME_MUTE && args[MA_ARG_MUTED] === undefined
				? { ...args, [MA_ARG_MUTED]: true }
				: args
		const arg = playerArgOf(rawName)
		if (typeof withMuted[arg] === "string" && withMuted[arg]) return withMuted
		if (filledArg(withMuted, MA_ARG_PLAYER)) return withMuted
		const player = await resolvePlayer(provider, null, null)
		if (!player) return withMuted
		return { ...withMuted, [arg]: playerTargetOf(rawName, player) }
	},
	postCall: (_provider, rawName, resolvedArgs, result, language) => {
		if (rawName !== MA_TOOL_VOLUME_MUTE || result.isError) return result
		const phrases = languageSetsFor(language).phrases
		const speakableText =
			resolvedArgs[MA_ARG_MUTED] === false
				? phrases.musicUnmuted
				: phrases.musicMuted
		return { ...result, speakableText } satisfies SkillCallResultType
	},
	describeInvocation: (
		provider,
		rawName,
		args,
		language,
	): ToolInvocationDescriptionType => {
		if (!filledArg(args, MA_ARG_PLAYER)) return {}
		const target = String(args[MA_ARG_PLAYER]).trim()
		const verb = forLanguage(MA_ACTION_VERBS, language)[rawName]
		return {
			target,
			targetNames: [target],
			implicit: isDefaultPlayer(provider, target, language ?? null),
			...(verb ? { summary: `${verb} ${target}` } : {}),
		}
	},
	inferWriteTarget: (provider, rawName, args): ToolTargetInferenceType => {
		const arg = playerArgOf(rawName)
		if (filledArg(args, arg) || filledArg(args, MA_ARG_PLAYER))
			return { kind: "targeted" }
		const players = playerRoster.snapshot(provider.id, rosterTtlMsOf(provider))
		if (players.length > 0 && getTraceContext()?.satelliteId)
			return { kind: "inferred", args: {} }
		const implicit = implicitPlayer(players)
		if (implicit)
			return {
				kind: "inferred",
				args: { [arg]: playerTargetOf(rawName, implicit) },
			}
		return { kind: "untargeted" }
	},
}
