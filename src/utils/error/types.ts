import { ERROR_CODES } from "./constants"

export type ErrorCodeType = {
	[K in keyof typeof ERROR_CODES]: (typeof ERROR_CODES)[K][keyof (typeof ERROR_CODES)[K]]
}[keyof typeof ERROR_CODES]
