import { z } from "zod"

import { configSchema } from "../schemas"

export type ConfigType = z.infer<typeof configSchema>

export type InitializeOptionsType = { isHosted?: boolean }
