import { emotionTagPattern, emotionTagLoosePattern } from "@/utils"
import type { TextDeltaEmitterType, TextDeltaSinkType } from "../types"

const stripEmotionTags = (text: string): string =>
	text.replace(emotionTagPattern(), "").replace(emotionTagLoosePattern(), "")

const openTagAt = (text: string): number => {
	const open = text.lastIndexOf("[")
	return open >= 0 && !text.includes("]", open) ? open : text.length
}

export const createTextDeltaEmitter = (
	sink: TextDeltaSinkType,
): TextDeltaEmitterType => {
	let held = ""
	const emit = (chunk: string): void => {
		const clean = stripEmotionTags(chunk)
		if (clean) sink(clean)
	}
	return {
		push: (token: string): void => {
			held += token
			const cut = openTagAt(held)
			if (cut === 0) return
			const ready = held.slice(0, cut)
			held = held.slice(cut)
			emit(ready)
		},
		flush: (): void => {
			if (!held) return
			const ready = held
			held = ""
			emit(ready)
		},
	}
}
