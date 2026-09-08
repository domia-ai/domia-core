import {
	DOMIA_LIVE_FIELDS,
	LLM_DRAIN_FIELDS,
	LLM_LIVE_FIELDS,
	MODULES_LIVE_FIELDS,
	MODULES_PROACTIVITY_FIELDS,
	MODULES_SKILLS_FIELDS,
	RELOAD_SCOPE,
	STT_LIVE_FIELDS,
	STT_POOL_FIELDS,
	TTS_LIVE_FIELDS,
	TTS_POOL_FIELDS,
	WAKE_WORD_LISTENER_FIELDS,
	WAKE_WORD_LIVE_FIELDS,
} from "../constants"
import type {
	ChangeActionType,
	ConfigApplyPlanType,
	ConfigChangeType,
	ReloadSubsystemType,
	ReloaderScopeType,
} from "../types"

const DOMIA_LIVE = new Set<string>(DOMIA_LIVE_FIELDS)
export const LLM_DRAIN = new Set<string>(LLM_DRAIN_FIELDS)
const CAP_LIVE_DRAIN = new Set(["stt", "tts", "playback"])

const FIELD_ACTION_TABLES: Partial<
	Record<string, readonly (readonly [ReadonlySet<string>, ChangeActionType])[]>
> = {
	stt: [
		[new Set<string>(STT_LIVE_FIELDS), "live"],
		[new Set<string>(STT_POOL_FIELDS), "stt-pool"],
	],
	tts: [
		[new Set<string>(TTS_LIVE_FIELDS), "live"],
		[new Set<string>(TTS_POOL_FIELDS), "tts-pool"],
	],
	llm: [
		[LLM_DRAIN, "live-drain"],
		[new Set<string>(LLM_LIVE_FIELDS), "live"],
	],
	wakeWord: [
		[new Set<string>(WAKE_WORD_LIVE_FIELDS), "live"],
		[new Set<string>(WAKE_WORD_LISTENER_FIELDS), "voice-listener"],
	],
	modules: [
		[new Set<string>(MODULES_SKILLS_FIELDS), "skills"],
		[new Set<string>(MODULES_PROACTIVITY_FIELDS), "proactivity"],
		[new Set<string>(MODULES_LIVE_FIELDS), "live"],
	],
}

const fromTable = (
	field: string,
	table: readonly (readonly [ReadonlySet<string>, ChangeActionType])[],
): ChangeActionType => {
	for (const [fields, action] of table) if (fields.has(field)) return action
	return "restart"
}

export const classifyChange = (
	section: string,
	field: string,
): ChangeActionType => {
	const table = FIELD_ACTION_TABLES[section]
	if (table) return fromTable(field, table)
	switch (section) {
		case "domia":
			if (field === "isHosted") return "identity"
			return DOMIA_LIVE.has(field) ? "live" : "restart"
		case "capabilities":
			if (field === "wakeword" || field === "record") return "voice-listener"
			return CAP_LIVE_DRAIN.has(field) ? "live-drain" : "live"
		case "mqttLocal":
			return "mqtt"
		case "skillProviders":
			return "skills"
		case "character":
			return field === "language" ? "skills" : "live"
		case "emotion":
		case "delegations":
			return "live"
		case "playback":
			return "live-drain"
		default:
			return "restart"
	}
}

export const isReloadSubsystem = (
	action: ChangeActionType,
): action is ReloadSubsystemType => action in RELOAD_SCOPE

export const classify = (changes: ConfigChangeType[]): ConfigApplyPlanType => {
	const reloads = new Map<ReloadSubsystemType, ReloaderScopeType>()
	let live = false
	let liveDrain = false
	let identity = false
	let restart = false
	for (const { section, field } of changes) {
		const action = classifyChange(section, field)
		if (action === "live") live = true
		else if (action === "live-drain") liveDrain = true
		else if (action === "identity") identity = true
		else if (action === "restart") restart = true
		else reloads.set(action, RELOAD_SCOPE[action])
	}
	return { live, liveDrain, reloads, identity, restart }
}
