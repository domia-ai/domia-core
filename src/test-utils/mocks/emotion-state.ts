import { faker } from "@faker-js/faker"

import { generateUuid, now } from "@/utils"
import { type SelectEmotionStateType } from "@/db"

export const baseEmotionState = (domiaId?: string): SelectEmotionStateType => {
	const randomEmotion = () =>
		Number(faker.number.float({ min: 0, max: 1 }).toFixed(3))

	return {
		id: generateUuid(),
		domiaId: domiaId ?? generateUuid(),
		joy: randomEmotion(),
		sadness: randomEmotion(),
		anger: randomEmotion(),
		fear: randomEmotion(),
		trust: randomEmotion(),
		disgust: randomEmotion(),
		anticipation: randomEmotion(),
		surprise: randomEmotion(),
		createdAt: now(),
		updatedAt: now(),
	}
}
