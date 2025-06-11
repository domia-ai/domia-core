import { z } from "zod"

import { configSchema } from "../schemas"
import { type SelectModuleSettingsType } from "@/db"

export type ConfigType = z.infer<typeof configSchema>

export type ModulesType = Pick<
	SelectModuleSettingsType,
	| "collectiveMind"
	| "emotionEngine"
	| "identityEngine"
	| "memoryEngine"
	| "narrativeEngine"
	| "remoteAccessEngine"
>

export type ModuleNameType = keyof ModulesType
