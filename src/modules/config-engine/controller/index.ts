import {
	dbClient,
	type InsertModuleSettingsType,
	type DBClientOrTxType,
} from "@/db"
import { getDomia, insertDomia, type DomiaType } from "@/modules/core"
import { configEngineLogger, domiaError, CORE_ERRORS } from "@/utils"

import { DEFAULT_CONFIG_VALUES } from "../constants"
import { type ConfigType, type ModuleNameType } from "../types"
import {
	getCharacterProfileCreateInputFromConfig,
	getDomiaCreateInputFromConfig,
	getModuleSettingsCreateInputFromConfig,
	getDomiaConfig,
	getEmotionStateCreateInputFromConfig,
	getWakeWordConfigCreateInputFromConfig,
	getSttConfigCreateInputFromConfig,
	getLlmModelConfigCreateInputFromConfig,
	getTtsConfigCreateInputFromConfig,
	getAudioPlaybackCOnfigCreateInputFromConfig,
} from "../utils"
import dbAdapter from "../db-adapter"
import { configSchema } from "../schemas"

export const initialize = async (
	initialConfig: ConfigType = DEFAULT_CONFIG_VALUES,
) => {
	configEngineLogger.info(
		"Initializing config engine with config",
		initialConfig,
	)

	const validatedConfig = configSchema.parse(initialConfig)
	const currentDomia = await getDomia(validatedConfig.domiaKey)

	if (currentDomia) {
		configEngineLogger.info("Found existing Domia instance", {
			domiaId: currentDomia.id,
		})
		return currentDomia
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
				getAudioPlaybackCOnfigCreateInputFromConfig(domiaId),
				tx,
			)
			.run()
	})

	const finalizedDomia = await getDomia(domiaId, false)
	configEngineLogger.info("Config engine initialization completed", { domiaId })

	return finalizedDomia
}

export const updateModuleSettingsByDomiaId = (
	domiaId: string,
	data: InsertModuleSettingsType,
	client?: DBClientOrTxType,
) => {
	configEngineLogger.info("Updating module settings", { domiaId, data })
	return dbAdapter.updateModuleSettingsByDomiaId(domiaId, data, client)
}

export const enableModule = async (
	domia: DomiaType,
	moduleName: ModuleNameType,
	client?: DBClientOrTxType,
) => {
	configEngineLogger.info("Enabling module", { domiaId: domia?.id, moduleName })
	const currentModuleSettings = domia?.moduleSettings
	if (!currentModuleSettings) {
		configEngineLogger.warn("No module settings found", { domiaId: domia?.id })
		return
	}

	return updateModuleSettingsByDomiaId(
		domia?.id,
		{
			...currentModuleSettings,
			[moduleName]: true,
		},
		client,
	)
}

export const disableModule = async (
	domia: DomiaType,
	moduleName: ModuleNameType,
	client?: DBClientOrTxType,
) => {
	configEngineLogger.info("Disabling module", {
		domiaId: domia?.id,
		moduleName,
	})
	const currentModuleSettings = domia?.moduleSettings
	if (!currentModuleSettings) {
		configEngineLogger.warn("No module settings found", { domiaId: domia?.id })
		return
	}

	return updateModuleSettingsByDomiaId(
		domia?.id,
		{
			...currentModuleSettings,
			[moduleName]: false,
		},
		client,
	)
}

export const isModuleEnabled = async (
	domia: DomiaType,
	moduleName: ModuleNameType,
) => {
	configEngineLogger.debug("Checking if module is enabled", {
		domiaId: domia?.id,
		moduleName,
	})
	return domia?.moduleSettings?.[moduleName]
}

export const reset = async (
	domia: DomiaType,
	config: ConfigType = DEFAULT_CONFIG_VALUES,
) => {
	configEngineLogger.info("Resetting Domia configuration", {
		domiaId: domia?.id,
	})
	const validatedConfig = configSchema.parse(config)
	const domiaId = domia?.id

	configEngineLogger.info("Starting database transaction for reset", {
		domiaId,
	})
	dbClient.transaction((tx) => {
		configEngineLogger.debug("Upserting module settings", { domiaId })
		dbAdapter
			.upsertModuleSettings(
				getModuleSettingsCreateInputFromConfig(domiaId, validatedConfig),
				tx,
			)
			.run()

		configEngineLogger.debug("Upserting emotion state", { domiaId })
		dbAdapter
			.upsertEmotionState(
				getEmotionStateCreateInputFromConfig(domiaId, validatedConfig),
				tx,
			)
			.run()

		configEngineLogger.debug("Upserting character profile", { domiaId })
		dbAdapter
			.upsertCharacterProfile(
				getCharacterProfileCreateInputFromConfig(domiaId, validatedConfig),
				tx,
			)
			.run()

		configEngineLogger.debug("Upserting wake word config", { domiaId })
		dbAdapter
			.upsertWakeWordConfig(getWakeWordConfigCreateInputFromConfig(domiaId), tx)
			.run()

		configEngineLogger.debug("Upserting stt config", { domiaId })
		dbAdapter
			.upsertSttConfig(getSttConfigCreateInputFromConfig(domiaId), tx)
			.run()

		configEngineLogger.debug("Upserting llm model config", { domiaId })
		dbAdapter
			.upsertLlmModelConfig(getLlmModelConfigCreateInputFromConfig(domiaId), tx)
			.run()

		configEngineLogger.debug("Upserting tts config", { domiaId })
		dbAdapter
			.upsertTtsConfig(getTtsConfigCreateInputFromConfig(domiaId), tx)
			.run()

		configEngineLogger.debug("Upserting audio playback config", { domiaId })
		dbAdapter
			.upsertAudioPlaybackConfig(
				getAudioPlaybackCOnfigCreateInputFromConfig(domiaId),
				tx,
			)
			.run()
	})

	const finalizedDomia = await getDomia(domiaId, false)
	configEngineLogger.info("Reset completed successfully", { domiaId })

	return finalizedDomia
}

export const exportConfig = async (domia: DomiaType): Promise<ConfigType> => {
	configEngineLogger.info("Exporting Domia configuration", {
		domiaId: domia?.id,
	})
	return getDomiaConfig(domia)
}

export const importConfig = async (domia: DomiaType, config: ConfigType) => {
	configEngineLogger.info("Importing configuration", { domiaId: domia?.id })
	await reset(domia, config)
	const dbDomia = await getDomia(domia?.id, false)
	configEngineLogger.info("Configuration import completed", {
		domiaId: domia?.id,
	})
	return dbDomia
}
