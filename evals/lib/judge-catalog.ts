import type { SkillDescriptorRoutingType, SkillToolType } from "@/db"
import { judgeCatalogOf } from "@/modules/core-bus/utils/skill-routing"
import type { JudgeCatalogType } from "@/modules/core-bus/types"
import {
	domiaSpecialization,
	homeAssistantSpecialization,
	musicAssistantSpecialization,
	toolBaseName,
	type SkillSpecializationType,
} from "@/modules/skill-engine"
import { DOMIA_TOOLS } from "@/modules/skill-engine/specializations/domia/tools"
import { maVirtualTools } from "@/modules/skill-engine/specializations/music-assistant/virtual-tools"

import { HA_MCP_TOOLS } from "./ha-tools"

export const JUDGE_HOME = "home-assistant"
export const JUDGE_MUSIC = "music-assistant"
export const JUDGE_BUILTIN = "domia"

const stub = (
	provider: string,
	rawName: string,
	description: string,
): SkillToolType => ({
	provider,
	rawName,
	namespacedName: `${provider}__${rawName}`,
	description,
	inputSchema: { type: "object", properties: { name: { type: "string" } } },
})

export const JUDGE_HOME_TOOLS: SkillToolType[] = [
	...HA_MCP_TOOLS.map((t) =>
		stub(JUDGE_HOME, `${t.domain}__${t.rawName}`, t.description),
	),
	stub(JUDGE_HOME, "lock__HassLockDoor", "Locks a door lock entity."),
	stub(JUDGE_HOME, "lock__HassUnlockDoor", "Unlocks a door lock entity."),
	stub(
		JUDGE_HOME,
		"assist_satellite__HassBroadcast",
		"Broadcast a message through the home.",
	),
]

export const JUDGE_MUSIC_TOOLS: SkillToolType[] = [
	stub(JUDGE_MUSIC, "playback_pause", "Pauses playback on a player queue."),
	stub(JUDGE_MUSIC, "playback_resume", "Resumes playback on a player queue."),
	stub(
		JUDGE_MUSIC,
		"playback_next_track",
		"Skips to the next track on a player queue.",
	),
	stub(
		JUDGE_MUSIC,
		"playback_previous_track",
		"Goes back to the previous track on a player queue.",
	),
	stub(
		JUDGE_MUSIC,
		"volume_volume_set",
		"Sets the volume of a player to an absolute level.",
	),
	stub(
		JUDGE_MUSIC,
		"volume_volume_up",
		"Raises the volume of a player one step.",
	),
	stub(
		JUDGE_MUSIC,
		"volume_volume_down",
		"Lowers the volume of a player one step.",
	),
	stub(JUDGE_MUSIC, "volume_volume_mute", "Mutes or unmutes a player."),
	...maVirtualTools().map((t) =>
		stub(JUDGE_MUSIC, t.name, t.description ?? ""),
	),
]

export const JUDGE_BUILTIN_TOOLS: SkillToolType[] = DOMIA_TOOLS.filter(
	(t) => !t.hiddenFromLlm,
).map((t) => stub(JUDGE_BUILTIN, t.name, t.definition.description ?? ""))

const specializations: [SkillSpecializationType, SkillToolType[]][] = [
	[homeAssistantSpecialization, JUDGE_HOME_TOOLS],
	[musicAssistantSpecialization, JUDGE_MUSIC_TOOLS],
	[domiaSpecialization, JUDGE_BUILTIN_TOOLS],
]

const routingFieldFor = <T>(
	language: string,
	pick: (
		routing: SkillDescriptorRoutingType | undefined,
	) => Record<string, T> | undefined,
): Record<string, T> => {
	const out: Record<string, T> = {}
	for (const [spec, tools] of specializations) {
		const byRaw = pick(spec.descriptorDefaults?.(tools, language).routing) ?? {}
		for (const tool of tools) {
			const key = [tool.rawName, toolBaseName(tool.rawName)].find((k) =>
				Object.hasOwn(byRaw, k),
			)
			if (key !== undefined) out[tool.namespacedName] = byRaw[key]
		}
	}
	return out
}

export const judgeToolExamplesFor = (
	language: string,
): Record<string, string[]> => routingFieldFor(language, (r) => r?.toolExamples)

export const judgeToolLabelsFor = (language: string): Record<string, string> =>
	routingFieldFor(language, (r) => r?.toolLabels)

const sorted = (tools: SkillToolType[]): SkillToolType[] =>
	[...tools].sort((a, b) => a.namespacedName.localeCompare(b.namespacedName))

export const judgeCatalogFor = (
	language: string,
	tools: SkillToolType[],
): JudgeCatalogType =>
	judgeCatalogOf(
		sorted(tools),
		judgeToolExamplesFor(language),
		judgeToolLabelsFor(language),
	)

export const JUDGE_FULL_TOOLS = [
	...JUDGE_BUILTIN_TOOLS,
	...JUDGE_HOME_TOOLS,
	...JUDGE_MUSIC_TOOLS,
]
