export const fold = (text: string): string =>
	text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[.,!?¡¿;:'"„“”]/g, " ")
		.replace(/\s+/g, " ")
		.trim()

export const tokensOf = (text: string): string[] =>
	fold(text).split(" ").filter(Boolean)

export const digitKey = (text: string): string => text.replace(/\d+/g, "#")
