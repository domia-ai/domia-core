export type RecentTurnType = {
	userText?: string
	domiaText?: string
	createdAt?: string
}

export type BuildPromptContextOptionsType = {
	recentTurns?: RecentTurnType[]
}
