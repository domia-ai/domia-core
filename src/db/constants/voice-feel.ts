import type { VoiceFeelRuleType } from "../json-types"

export const DEFAULT_VOICE_FEEL_AUTOTUNE_ENABLED = false
export const DEFAULT_VOICE_FEEL_WINDOW_TURNS = 40
export const DEFAULT_VOICE_FEEL_MIN_TURNS = 15
export const DEFAULT_VOICE_FEEL_DAILY_BUDGET = 4
export const DEFAULT_VOICE_FEEL_COOLDOWN_MS = 21_600_000
export const DEFAULT_VOICE_FEEL_TICK_MS = 60_000

export const DEFAULT_VOICE_FEEL_RULES: VoiceFeelRuleType[] = [
	{
		id: "cut-off-user",
		when: [{ feature: "cutOffRate", op: "gt", value: 0.25 }],
		knob: { section: "wakeWord", field: "vadMinSilenceS" },
		step: 0.1,
		min: 0.3,
		max: 1,
		minTurns: DEFAULT_VOICE_FEEL_MIN_TURNS,
		enabled: true,
	},
	{
		id: "early-barge-in",
		when: [{ feature: "earlyBargeInRate", op: "gt", value: 0.2 }],
		knob: { section: "wakeWord", field: "vadMinSilenceS" },
		step: 0.1,
		min: 0.3,
		max: 1,
		minTurns: DEFAULT_VOICE_FEEL_MIN_TURNS,
		enabled: true,
	},
	{
		id: "late-barge-in",
		when: [{ feature: "lateBargeInRate", op: "gt", value: 0.3 }],
		knob: { section: "llm", field: "numPredict" },
		step: -32,
		min: 64,
		max: 512,
		minTurns: DEFAULT_VOICE_FEEL_MIN_TURNS,
		enabled: false,
	},
	{
		id: "slow-ttfa",
		when: [
			{ feature: "perceivedTtfaP50", op: "gt", value: 1800 },
			{ feature: "eouDelayP50", op: "gt", value: 600 },
			{ feature: "cutOffRate", op: "lt", value: 0.1 },
		],
		knob: { section: "wakeWord", field: "vadMinSilenceS" },
		step: -0.05,
		min: 0.3,
		max: 1,
		minTurns: DEFAULT_VOICE_FEEL_MIN_TURNS,
		enabled: true,
	},
]

export const DEFAULT_VOICE_FEEL_ADJUSTMENT_MAX_AGE_MS = 180 * 86_400_000
