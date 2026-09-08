export const parseDbTimestamp = (value: string | null | undefined): number => {
	if (!value) return NaN
	const normalized = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`
	return Date.parse(normalized)
}

export const sqliteTimestamp = (at: number): string =>
	new Date(at).toISOString().replace("T", " ").replace("Z", "")
