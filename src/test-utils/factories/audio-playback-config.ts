import { type SelectAudioPlaybackConfigType } from "@/db"
import { baseAudioPlaybackConfig } from "../mocks"

export const getAudioPlaybackConfig = (
	overrides: Partial<SelectAudioPlaybackConfigType> = {},
): SelectAudioPlaybackConfigType => {
	return {
		...baseAudioPlaybackConfig(overrides?.domiaId),
		...overrides,
	}
}
