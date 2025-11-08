import { type SelectRuntimeCapabilitiesType } from "@/db"
import { baseRuntimeCapabilities } from "../mocks"

export const getRuntimeCapabilities = (
	overrides: Partial<SelectRuntimeCapabilitiesType> = {},
): SelectRuntimeCapabilitiesType => {
	return {
		...baseRuntimeCapabilities(overrides?.domiaId),
		...overrides,
	}
}
