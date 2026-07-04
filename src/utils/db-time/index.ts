export const parseDbTimestamp = (value: string | null | undefined): number => {
	if (!value) return NaN
	const normalized = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`
	return Date.parse(normalized)
}
