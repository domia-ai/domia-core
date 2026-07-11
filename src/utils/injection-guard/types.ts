export type SanitizeResultType = {
	text: string
	flagged: boolean
	reasons: string[]
	truncated: boolean
}

export type SanitizeOptionsType = {
	maxLength?: number
	collapseNewlines?: boolean
}
