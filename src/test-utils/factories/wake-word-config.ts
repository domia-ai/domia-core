import { type SelectWakeWordConfigType } from "@/db"
import { baseWakeWordConfig } from "../mocks"

export const getWakeWordConfig = (
	overrides: Partial<SelectWakeWordConfigType> = {},
): SelectWakeWordConfigType => {
	return {
		...baseWakeWordConfig(overrides?.domiaId),
		...overrides,
	}
}
