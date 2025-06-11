import { type SelectLlmModelConfigType } from "@/db"
import { baseLlmModelConfig } from "../mocks"

export const getLlmModelConfig = (
	overrides: Partial<SelectLlmModelConfigType> = {},
): SelectLlmModelConfigType => {
	return {
		...baseLlmModelConfig(overrides?.domiaId),
		...overrides,
	}
}
