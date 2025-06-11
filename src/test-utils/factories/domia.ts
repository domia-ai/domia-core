import { type SelectDomiaType } from "@/db"
import { type DomiaType } from "@/modules/core"
import { type GetDomiaParamsType } from "../types"
import { baseDomia } from "../mocks"
import { getEmotionState } from "./emotion-state"
import { getModuleSettings } from "./module-settings"
import { getCharacterProfile } from "./character-profile"
import { getWakeWordConfig } from "./wake-word-config"
import { getSttConfig } from "./stt-config"
import { getLlmModelConfig } from "./llm-model-config"
import { getTtsConfig } from "./tts-config"
import { getMcpServerConfig } from "./mcp-server-config"
import { getAudioPlaybackConfig } from "./audio-playback-config"

export const getBaseDomia = (
	overrides: Partial<SelectDomiaType> = {},
): SelectDomiaType => ({
	...baseDomia,
	...overrides,
})

export const getDomia = ({
	domiaOverrides = {},
	emotionStateOverrides = {},
	moduleSettingsOverrides = {},
	characterProfileOverrides = {},
	wakeWordConfigOverrides = {},
	sttConfigOverrides = {},
	llmModelConfigOverrides = {},
	ttsConfigOverrides = {},
	audioPlaybackConfigOverrides = {},
	mcpServerConfigOverrides = {},
}: GetDomiaParamsType): DomiaType => {
	const baseDomia = getBaseDomia(domiaOverrides)
	const emotionState = getEmotionState({
		...emotionStateOverrides,
		domiaId: baseDomia?.id,
	})
	const moduleSettings = getModuleSettings({
		...moduleSettingsOverrides,
		domiaId: baseDomia?.id,
	})
	const characterProfile = getCharacterProfile({
		...characterProfileOverrides,
		domiaId: baseDomia?.id,
	})
	const wakeWordConfig = getWakeWordConfig({
		...wakeWordConfigOverrides,
		domiaId: baseDomia?.id,
	})
	const sttConfig = getSttConfig({
		...sttConfigOverrides,
		domiaId: baseDomia?.id,
	})
	const llmModelConfig = getLlmModelConfig({
		...llmModelConfigOverrides,
		domiaId: baseDomia?.id,
	})
	const ttsConfig = getTtsConfig({
		...ttsConfigOverrides,
		domiaId: baseDomia?.id,
	})
	const audioPlaybackConfig = getAudioPlaybackConfig({
		...audioPlaybackConfigOverrides,
		domiaId: baseDomia?.id,
	})
	const mcpServerConfig = getMcpServerConfig({
		...mcpServerConfigOverrides,
		domiaId: baseDomia?.id,
	})

	return {
		...baseDomia,
		emotionState,
		moduleSettings,
		characterProfile,
		wakeWordConfig,
		sttConfig,
		llmModelConfig,
		ttsConfig,
		audioPlaybackConfig,
		mcpServerConfigs: [mcpServerConfig],
	}
}
