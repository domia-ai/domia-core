const CLOCK_PATTERN = /^(\d{1,2}):(\d{2})$/

export const parseClock = (value: string | null | undefined): number | null => {
	if (!value) return null
	const match = CLOCK_PATTERN.exec(value.trim())
	if (!match) return null
	const hours = Number(match[1])
	const minutes = Number(match[2])
	if (hours > 23 || minutes > 59) return null
	return hours * 60 + minutes
}
