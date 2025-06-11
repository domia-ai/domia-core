import { type SelectEmotionStateType } from "@/db"
import { baseEmotionState } from "../mocks"

export const getEmotionState = (
	overrides: Partial<SelectEmotionStateType> = {},
): SelectEmotionStateType => {
	return {
		...baseEmotionState(overrides?.domiaId),
		...overrides,
	}
}
