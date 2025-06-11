import { type SelectModuleSettingsType } from "@/db"
import { baseModuleSettings } from "../mocks"

export const getModuleSettings = (
	overrides: Partial<SelectModuleSettingsType> = {},
): SelectModuleSettingsType => {
	return {
		...baseModuleSettings(overrides?.domiaId),
		...overrides,
	}
}
