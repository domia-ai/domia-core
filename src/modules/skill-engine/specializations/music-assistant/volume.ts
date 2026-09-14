import type { SelectSkillProviderType } from "@/db"
import {
	externalMediaKey,
	getExternalMediaControls,
	type ExternalMediaControlsType,
} from "@/modules/audio-playback"
import { languageSetsFor, skillEngineLogger } from "@/utils"

import dbAdapter from "../../db-adapter"
import type { SkillCallResultType } from "../../types"
import {
	MA_ARG_LEVEL,
	MA_ARG_MUTED,
	MA_ARG_PLAYER_ID,
	MA_TOOL_VOLUME_MUTE,
	MA_TOOL_VOLUME_SET,
	MA_TOOL_VOLUME_UP,
	MA_VOLUME_MAX,
	MA_VOLUME_MIN,
	MA_VOLUME_TOOLS,
} from "./constants"
import { volumeChangedText, volumeFailedText } from "./planner"
import { playerRoster, volumeStepPercentOf } from "./roster"
import type { MaPlayerType } from "./types"

const preMuteLevels = new Map<string, number>()

const preMuteKey = (provider: SelectSkillProviderType, playerId: string) =>
	`${provider.id}:${playerId}`

export const forgetPreMuteLevels = (
	provider: SelectSkillProviderType,
): void => {
	const prefix = preMuteKey(provider, "")
	for (const key of [...preMuteLevels.keys()])
		if (key.startsWith(prefix)) preMuteLevels.delete(key)
}

const clampLevel = (level: number): number =>
	Math.min(MA_VOLUME_MAX, Math.max(MA_VOLUME_MIN, Math.round(level)))

const targetPlayer = (
	provider: SelectSkillProviderType,
	args: Record<string, unknown>,
): MaPlayerType | null => {
	const id = args[MA_ARG_PLAYER_ID]
	if (typeof id !== "string" || !id) return null
	return (
		playerRoster.snapshot(provider.id).find((p) => p.playerId === id) ?? null
	)
}

const transportControlsFor = (
	provider: SelectSkillProviderType,
	player: MaPlayerType,
): ExternalMediaControlsType | null => {
	const satelliteId = dbAdapter.satelliteIdForPlayerName(
		provider.domiaId,
		player.name,
	)
	if (!satelliteId) return null
	const domiaKey = dbAdapter.domiaKeyOf(provider.domiaId)
	if (!domiaKey) return null
	return getExternalMediaControls(externalMediaKey(domiaKey, satelliteId))
}

const nextLevel = (
	provider: SelectSkillProviderType,
	controls: ExternalMediaControlsType,
	rawName: string,
	args: Record<string, unknown>,
	memoryKey: string,
): number | null => {
	const step = volumeStepPercentOf(provider)
	if (rawName === MA_TOOL_VOLUME_SET) {
		const level = args[MA_ARG_LEVEL]
		return typeof level === "number" && Number.isFinite(level)
			? clampLevel(level)
			: null
	}
	const current = controls.getVolume()
	if (rawName === MA_TOOL_VOLUME_MUTE) {
		if (args[MA_ARG_MUTED] === false)
			return clampLevel(
				preMuteLevels.get(memoryKey) ??
					(current !== null && current > MA_VOLUME_MIN ? current : step),
			)
		if (current !== null && current > MA_VOLUME_MIN)
			preMuteLevels.set(memoryKey, current)
		return MA_VOLUME_MIN
	}
	if (current === null) return null
	return clampLevel(
		rawName === MA_TOOL_VOLUME_UP ? current + step : current - step,
	)
}

export const runVolumeViaTransport = (
	provider: SelectSkillProviderType,
	rawName: string,
	args: Record<string, unknown>,
	language: string | null,
): Promise<SkillCallResultType> | null => {
	if (!MA_VOLUME_TOOLS.includes(rawName)) return null
	const player = targetPlayer(provider, args)
	if (!player) return null
	if (player.volumeLevel !== null) return null
	const controls = transportControlsFor(provider, player)
	if (!controls) return null
	const memoryKey = preMuteKey(provider, player.playerId)
	const level = nextLevel(provider, controls, rawName, args, memoryKey)
	if (level === null) return null
	const phrases = languageSetsFor(language).phrases
	return (async () => {
		const applied = await controls.setVolume(level)
		if (!applied)
			return {
				text: volumeFailedText(phrases, player.name),
				status: "error",
				isError: true,
			} satisfies SkillCallResultType
		skillEngineLogger.info(
			`🎵 volume via ${controls.origin} → ${player.name} ${level}%`,
			{ tool: rawName },
		)
		return {
			text: volumeChangedText(phrases, player.name, level),
			status: "ok",
			isError: false,
			structured: { player: player.playerId, level },
		} satisfies SkillCallResultType
	})()
}
