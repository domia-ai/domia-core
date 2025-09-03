import { type SelectMqttConfigType } from "@/db"
import { baseMqttConfig } from "../mocks"

export const getMqttConfig = (
	overrides: Partial<SelectMqttConfigType> = {},
): SelectMqttConfigType => {
	return {
		...baseMqttConfig(overrides?.domiaId),
		...overrides,
	}
}
