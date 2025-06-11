import { DomiaType } from "@/modules/core"
import {
	type AudioPlaybackEngineEnumType,
	AUDIO_PLAYBACK_ENGINE_ENUM,
} from "@/db"

import { runSox } from "./sox"
import { runPlaySound } from "./play-sound"
import { type AudioPlaybackResult } from "../types"

export const audioPlaybackEngines: Record<
	AudioPlaybackEngineEnumType,
	(domia: DomiaType, filePath: string) => Promise<AudioPlaybackResult>
> = {
	[AUDIO_PLAYBACK_ENGINE_ENUM.SOX]: runSox,
	[AUDIO_PLAYBACK_ENGINE_ENUM.PLAY_SOUND]: runPlaySound,
}
