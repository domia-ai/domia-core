import { type SelectCapabilityDelegationType } from "@/db"
import { baseCapabilityDelegation } from "../mocks"

export const getCapabilityDelegation = (
	overrides: Partial<SelectCapabilityDelegationType> = {},
): SelectCapabilityDelegationType => {
	return {
		...baseCapabilityDelegation(overrides?.domiaId),
		...overrides,
	}
}
