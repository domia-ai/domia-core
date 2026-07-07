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
	knowledgeBase?: string[]
	previously?: string[]
	userModel?: string | null
	userMoodTrend?: string[]
	omitUserInput?: boolean
}

export type PersonaContextType = z.infer<typeof personaContextSchema>

export type EmotionEntryType = [string, number]
