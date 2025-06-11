import { type SelectTtsConfigType } from "@/db"
import { baseTtsConfig } from "../mocks"

export const getTtsConfig = (
	overrides: Partial<SelectTtsConfigType> = {},
): SelectTtsConfigType => {
	return {
		...baseTtsConfig(overrides?.domiaId),
		...overrides,
	}
}
