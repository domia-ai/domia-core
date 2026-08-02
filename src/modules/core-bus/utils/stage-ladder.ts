import type { LadderStageType, LadderTimestampsType } from "../types"

const MAX_TRACKED = 256

const ladderByInteraction = new Map<string, LadderTimestampsType>()

export const markLadderStage = (
	interactionId: string | undefined,
	stage: LadderStageType,
	at: number = Date.now(),
): void => {
	if (!interactionId) return
	const existing = ladderByInteraction.get(interactionId)
	if (existing) {
		if (existing[stage] === undefined) existing[stage] = at
		return
	}
	if (ladderByInteraction.size >= MAX_TRACKED) {
		const oldest = ladderByInteraction.keys().next().value
		if (oldest) ladderByInteraction.delete(oldest)
	}
	ladderByInteraction.set(interactionId, { [stage]: at })
}

export const ladderCols = (interactionId: string): LadderTimestampsType => {
	const m = ladderByInteraction.get(interactionId)
	return m ? { ...m } : {}
}

export const clearLadder = (interactionId: string): void => {
	ladderByInteraction.delete(interactionId)
}

export const stampFirstTokenIterable = (
	interactionId: string,
	tokens: AsyncIterable<string>,
): AsyncIterable<string> => ({
	[Symbol.asyncIterator]: () => {
		const inner = tokens[Symbol.asyncIterator]()
		let stamped = false
		return {
			next: async (): Promise<IteratorResult<string>> => {
				const result = await inner.next()
				if (!stamped && !result.done) {
					stamped = true
					markLadderStage(interactionId, "llmFirstTokenAt")
				}
				return result
			},
			return: (value?: unknown): Promise<IteratorResult<string>> =>
				inner.return
					? inner.return(value)
					: Promise.resolve({ done: true, value: undefined }),
			throw: (err?: unknown): Promise<IteratorResult<string>> =>
				inner.throw
					? inner.throw(err)
					: Promise.reject(err instanceof Error ? err : new Error(String(err))),
		}
	},
})

export const stampFirstTokenCallback = <T>(
	interactionId: string,
	onToken: (token: T) => void,
): ((token: T) => void) => {
	let stamped = false
	return (token: T): void => {
		if (!stamped) {
			stamped = true
			markLadderStage(interactionId, "llmFirstTokenAt")
		}
		onToken(token)
	}
}
