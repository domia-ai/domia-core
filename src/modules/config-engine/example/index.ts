import {
	initialize,
	enableModule,
	disableModule,
	isModuleEnabled,
	reset,
	exportConfig,
	importConfig,
} from "../"
;(async () => {
	const domia = await initialize()

	if (!domia) {
		throw new Error(`Domia not found`)
	}

	await reset(domia)
	await enableModule(domia, "emotionEngine")
	await disableModule(domia, "narrativeEngine")
	await disableModule(domia, "collectiveMind")
	await isModuleEnabled(domia, "narrativeEngine")
	const config = await exportConfig(domia)
	await importConfig(domia, config)
})()
