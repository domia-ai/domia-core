import { VOICE_FEEL_REVERT_WORSEN_RATIO } from "../constants"
import type {
	VoiceFeelDeltaType,
	VoiceFeelFeaturesType,
	VoiceFeelRuleType,
} from "../types"

export const shouldRevert = (
	before: VoiceFeelFeaturesType,
	after: VoiceFeelFeaturesType,
	rule: VoiceFeelRuleType,
): VoiceFeelDeltaType | null => {
	const driver = rule.when.at(0)
	if (!driver) return null
	const was = before[driver.feature]
	const now = after[driver.feature]
	const worsened =
		driver.op === "gt"
			? was <= 0
				? now > 0
				: now > was * (1 + VOICE_FEEL_REVERT_WORSEN_RATIO)
			: was <= 0
				? false
				: now < was * (1 - VOICE_FEEL_REVERT_WORSEN_RATIO)
	if (!worsened) return null
	return {
		section: rule.knob.section,
		field: rule.knob.field,
		step: -rule.step,
	}
}
