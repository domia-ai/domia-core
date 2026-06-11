import { dbClient } from "@/db"
import { getDomia, insertDomia } from "@/modules/core"
import { refreshDomiaLocalIp } from "@/modules/network-sync"
import { configEngineLogger, domiaError, CORE_ERRORS } from "@/utils"

import { DEFAULT_CONFIG_VALUES } from "../constants"
import { type ConfigType } from "../types"
import {
	getRuntimeCapabilitiesCreateInputFromConfig,
	getCharacterProfileCreateInputFromConfig,
	getDomiaCreateInputFromConfig,
	getModuleSettingsCreateInputFromConfig,
	getEmotionStateCreateInputFromConfig,
	getWakeWordConfigCreateInputFromConfig,
	getSttConfigCreateInputFromConfig,
	getLlmModelConfigCreateInputFromConfig,
	getTtsConfigCreateInputFromConfig,
	getAudioPlaybackConfigCreateInputFromConfig,
	getMqttConfigCreateInputFromConfig,
} from "../utils"
import dbAdapter from "../db-adapter"
import { configSchema } from "../schemas"

export const initialize = async (
	initialConfig: ConfigType = DEFAULT_CONFIG_VALUES,
) => {
	configEngineLogger.info("Initializing config engine with config")

	const validatedConfig = configSchema.parse(initialConfig)
	const currentDomia = await getDomia(validatedConfig.domiaKey)

	if (currentDomia) {
		configEngineLogger.info("Found existing Domia instance", {
			domiaId: currentDomia.id,
		})
		return refreshDomiaLocalIp(currentDomia)
	}

	configEngineLogger.info("Creating new Domia instance")
	const [insertedDomia] = await insertDomia(
		getDomiaCreateInputFromConfig(validatedConfig),
		dbClient,
	)
	const initializedDomia = await getDomia(insertedDomia?.id, false)
	const domiaId = initializedDomia?.id

	if (!domiaId) {
		throw domiaError(CORE_ERRORS.DOMIA_NOT_FOUND, {
			logger: configEngineLogger,
			meta: {
				initializedDomia,
			},
		})
	}

	configEngineLogger.info("Starting database transaction for initial setup", {
		domiaId,
	})
	dbClient.transaction((tx) => {
		configEngineLogger.debug("Creating runtime capabilities", { domiaId })
		dbAdapter
			.insertRuntimeCapabilities(
				getRuntimeCapabilitiesCreateInputFromConfig(domiaId, validatedConfig),
				tx,
			)
			.run()

		configEngineLogger.debug("Creating module settings", { domiaId })
		dbAdapter
			.insertModuleSettings(
				getModuleSettingsCreateInputFromConfig(domiaId, validatedConfig),
				tx,
			)
			.run()

		configEngineLogger.debug("Creating character profile", { domiaId })
		dbAdapter
			.insertCharacterProfile(
				getCharacterProfileCreateInputFromConfig(domiaId, validatedConfig),
				tx,
			)
			.run()

		configEngineLogger.debug("Creating emotion state", { domiaId })
		dbAdapter
			.insertEmotionState(
				getEmotionStateCreateInputFromConfig(domiaId, validatedConfig),
				tx,
			)
			.run()

		configEngineLogger.debug("Creating wake word config", { domiaId })
		dbAdapter
			.insertWakeWordConfig(getWakeWordConfigCreateInputFromConfig(domiaId), tx)
			.run()

		configEngineLogger.debug("Creating stt config", { domiaId })
		dbAdapter
			.insertSttConfig(getSttConfigCreateInputFromConfig(domiaId), tx)
			.run()

		configEngineLogger.debug("Creating llm model config", { domiaId })
		dbAdapter
			.insertLlmModelConfig(getLlmModelConfigCreateInputFromConfig(domiaId), tx)
			.run()

		configEngineLogger.debug("Creating tts config", { domiaId })
		dbAdapter
			.insertTtsConfig(getTtsConfigCreateInputFromConfig(domiaId), tx)
			.run()

		configEngineLogger.debug("Creating audio playback config", { domiaId })
		dbAdapter
			.insertAudioPlaybackConfig(
				getAudioPlaybackConfigCreateInputFromConfig(domiaId),
				tx,
			)
			.run()

		configEngineLogger.debug("Creating mqtt config", { domiaId })
		dbAdapter
			.insertMqttConfig(getMqttConfigCreateInputFromConfig(domiaId), tx)
			.run()
	})

	const finalizedDomia = await getDomia(domiaId, false)
	configEngineLogger.info("Config engine initialization completed", { domiaId })

	if (!finalizedDomia) {
		throw domiaError(CORE_ERRORS.DOMIA_NOT_FOUND, {
			logger: configEngineLogger,
			meta: {
				initializedDomia,
			},
		})
	}

	return finalizedDomia
}
