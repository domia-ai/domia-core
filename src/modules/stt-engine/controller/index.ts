import { type DomiaType } from "@/modules/core"
import { STT_ENGINE_ENUM_VALUES } from "@/db"
import { STT_ERRORS, sttEngineLogger, domiaError } from "@/utils"
import { sttEngines } from "../engines"

export const runSTT = async (domia: DomiaType, filePath: string) => {
	const sttConfig = domia?.sttConfig
	const engine = sttConfig?.engine

	if (!engine || !STT_ENGINE_ENUM_VALUES?.includes(engine)) {
		throw domiaError(STT_ERRORS.STT_ENGINE_NOT_FOUND, {
			logger: sttEngineLogger,
			meta: {
				engine,
			},
		})
	}

	const handler = sttEngines[engine]

	return await handler(domia, filePath)
}
