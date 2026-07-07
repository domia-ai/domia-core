export const fold = (s: string): string =>
	s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim()

export const tokensOf = (s: string): string[] =>
	fold(s)
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length >= 2)
