import { type SelectSttConfigType } from "@/db"
import { baseSttConfig } from "../mocks"

export const getSttConfig = (
	overrides: Partial<SelectSttConfigType> = {},
): SelectSttConfigType => {
	return {
		...baseSttConfig(overrides?.domiaId),
		...overrides,
	}
}
