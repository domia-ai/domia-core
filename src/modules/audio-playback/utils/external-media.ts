import type {
	ExternalMediaControlsType,
	ExternalMediaStateType,
} from "../types"

const externalMedia = new Map<string, ExternalMediaStateType>()
const externalMediaControls = new Map<string, ExternalMediaControlsType>()

export const externalMediaKey = (
	domiaKey: string,
	satelliteId: string | null,
): string => `${domiaKey}:${satelliteId ?? "local"}`

export const noteExternalMedia = (key: string, playing: boolean): void => {
	externalMedia.set(key, { playing, notedAt: Date.now() })
}

export const clearExternalMedia = (key: string): void => {
	externalMedia.delete(key)
}

export const isExternalMediaPlaying = (key: string): boolean =>
	externalMedia.get(key)?.playing === true

export const registerExternalMediaControls = (
	key: string,
	controls: ExternalMediaControlsType,
): void => {
	externalMediaControls.set(key, controls)
}

export const unregisterExternalMediaControls = (key: string): void => {
	externalMediaControls.delete(key)
}

export const getExternalMediaControls = (
	key: string,
): ExternalMediaControlsType | null => externalMediaControls.get(key) ?? null
