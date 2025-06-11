import crypto from "crypto"

import { WithParsedDatesType } from "@/db"

export const generateUuid = () => crypto.randomUUID()

export const now = () => new Date().toISOString()

export const parseDates = <
	T extends { createdAt: string | null; updatedAt: string | null },
>(
	obj: T,
): WithParsedDatesType<T> => {
	const createdAt = obj?.createdAt
	const updatedAt = obj?.updatedAt

	return {
		...obj,
		createdAt: createdAt ? new Date(createdAt) : null,
		updatedAt: updatedAt ? new Date(updatedAt) : null,
	}
}
