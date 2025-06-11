import { type SelectCharacterProfileType } from "@/db"
import { baseCharacterProfile } from "../mocks"

export const getCharacterProfile = (
	overrides: Partial<SelectCharacterProfileType> = {},
): SelectCharacterProfileType => {
	return {
		...baseCharacterProfile(overrides?.domiaId),
		...overrides,
	}
}
