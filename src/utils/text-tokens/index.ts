import type { TokensOptionsType } from "./types"

const DEFAULT_TOKEN_MIN_LENGTH = 2
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/u

export const foldText = (text: string): string =>
	text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim()

export const tokensOf = (
	text: string,
	options?: TokensOptionsType,
): string[] => {
	const minLength = options?.minLength ?? DEFAULT_TOKEN_MIN_LENGTH
	const stopwords = options?.stopwords
	return foldText(text)
		.split(NON_ALPHANUMERIC)
		.filter((word) => word.length >= minLength && !stopwords?.has(word))
}
