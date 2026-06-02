import { z } from "zod"

import { factSchema } from "../schemas"

export type RawFactType = z.infer<typeof factSchema>
