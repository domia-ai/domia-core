import { WAKE_VERIFIER_ENUM } from "@/db"
import { matchWakePhrase } from "../../utils"
import type {
	WakeVerdictType,
	WakeVerifierEngineAdapterType,
} from "../../types"

const FAIL_OPEN: WakeVerdictType = {
	accepted: true,
	score: 1,
	detail: "",
	failedOpen: true,
}

export const sttWakeVerifier: WakeVerifierEngineAdapterType = {
	id: WAKE_VERIFIER_ENUM.STT,
	concurrent: true,
	verify: async ({ pcm, sampleRate, transcribe }, config) => {
		if (!transcribe)
			return { ...FAIL_OPEN, detail: "no in-process transcriber" }
		if (pcm.length === 0) return { ...FAIL_OPEN, detail: "empty window" }

		const startedAt = Date.now()
		let budgetTimer: NodeJS.Timeout | undefined
		const timeout = new Promise<null>((resolve) => {
			budgetTimer = setTimeout(() => resolve(null), config.wakeVerifierMaxMs)
		})
		const transcript = await Promise.race([
			transcribe(pcm, sampleRate),
			timeout,
		]).finally(() => clearTimeout(budgetTimer))
		const elapsedMs = Date.now() - startedAt
		if (transcript === null)
			return {
				...FAIL_OPEN,
				detail: `timeout budget=${config.wakeVerifierMaxMs}ms`,
			}

		const match = matchWakePhrase(transcript, config.wakeWord)
		return {
			accepted: match.score >= config.wakeVerifierMinScore,
			score: match.score,
			detail: `transcript="${transcript.trim()}" candidate="${match.candidate}" tookMs=${elapsedMs}`,
		}
	},
}
