import { z } from "zod"

import {
	personaContextSchema,
	recentTurnSchema,
	promptOverridesSchema,
} from "../schemas"

export type RecentTurnType = z.infer<typeof recentTurnSchema>
export type PromptOverridesType = z.infer<typeof promptOverridesSchema>

export type BuildPromptContextOptionsType = {
	recentTurns?: RecentTurnType[]
	knownFacts?: string[]
	userMoodTrend?: string[]
}

export type PersonaContextType = z.infer<typeof personaContextSchema>
