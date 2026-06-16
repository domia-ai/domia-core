import { type SelectSkillProviderType } from "@/db"
import { baseSkillProvider } from "../mocks"

export const getSkillProvider = (
	overrides: Partial<SelectSkillProviderType> = {},
): SelectSkillProviderType => {
	return {
		...baseSkillProvider(overrides?.domiaId),
		...overrides,
	}
}
