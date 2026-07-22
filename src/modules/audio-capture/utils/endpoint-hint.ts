const COMPLETE_TAIL = /[.!?]["”'’]?$/
const ORDINAL_TAIL = /(?:^|\s)\d+\.$/
const INCOMPLETE_TAIL =
	/(?:,|—|:|\b(?:and|or|but|so|to|the|a|an|of|in|on|at|with|for|my|your|his|her|their|our|if|that|then|could|would|can|will|is|are|was))$/i
const FILLER_TAIL =
	/\b(?:um+|uh+|er+|hmm+|mm+|uhh+|erm|well|like|actually|let me think|let me see|let's see|give me a (?:sec|second|moment)|hold on|one (?:sec|second|moment)|i think|i mean|you know|how do i (?:say|put) (?:this|it))$/i

const ENDPOINT_DEBOUNCE_MIN_MS = 150
const ENDPOINT_DEBOUNCE_MAX_MS = 2000

export const clampEndpointDebounceMs = (ms: number): number =>
	Math.max(ENDPOINT_DEBOUNCE_MIN_MS, Math.min(ENDPOINT_DEBOUNCE_MAX_MS, ms))

export const endpointHintMs = (
	partial: string,
	completeMs: number,
	incompleteMs: number,
	waitMs: number,
): number | null => {
	const t = partial.trim()
	if (!t) return null
	if (FILLER_TAIL.test(t)) return waitMs
	if (ORDINAL_TAIL.test(t)) return incompleteMs
	if (COMPLETE_TAIL.test(t)) return completeMs
	if (INCOMPLETE_TAIL.test(t)) return incompleteMs
	return completeMs
}
