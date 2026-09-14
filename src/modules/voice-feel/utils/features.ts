import { IMPLICIT_FEEDBACK_ENUM, INTERACTION_STATUS_ENUM } from "@/db/constants"
import { endpointHintMs } from "@/modules/audio-capture/utils/endpoint-hint"
import { percentile } from "@/utils/stats"

import {
	VOICE_FEEL_HEARD_RATIO_BOUNDARY,
	VOICE_FEEL_RATE_DIGITS,
} from "../constants"
import type { VoiceFeelFeaturesType, VoiceFeelTraceRowType } from "../types"
import { roundTo } from "./round"

const HINT_COMPLETE = 1
const HINT_INCOMPLETE = 2
const HINT_WAIT = 3

const rate = (count: number, total: number): number =>
	total === 0 ? 0 : roundTo(count / total, VOICE_FEEL_RATE_DIGITS)

const text = (value: string | null | undefined): string => (value ?? "").trim()

const looksCutOff = (stt: string): boolean => {
	const hint = endpointHintMs(stt, HINT_COMPLETE, HINT_INCOMPLETE, HINT_WAIT)
	return hint === HINT_INCOMPLETE || hint === HINT_WAIT
}

const heardRatio = (row: VoiceFeelTraceRowType): number => {
	const spoken = text(row.llmResponse)
	if (!spoken) return 0
	return Math.min(1, text(row.heardReply).length / spoken.length)
}

const numbers = (
	rows: readonly VoiceFeelTraceRowType[],
	pick: (row: VoiceFeelTraceRowType) => number | null | undefined,
): number[] =>
	rows
		.map(pick)
		.filter((v): v is number => typeof v === "number" && Number.isFinite(v))

export const computeVoiceFeelFeatures = (
	rows: readonly VoiceFeelTraceRowType[],
): VoiceFeelFeaturesType => {
	const turns = rows.length
	const bargeIns = rows.filter(
		(r) => r.implicitFeedback === IMPLICIT_FEEDBACK_ENUM.BARGE_IN,
	)
	const early = bargeIns.filter(
		(r) => heardRatio(r) < VOICE_FEEL_HEARD_RATIO_BOUNDARY,
	).length
	const spoken = rows.filter((r) => text(r.sttResult).length > 0)
	const cutOff = spoken.filter((r) => looksCutOff(text(r.sttResult))).length
	const noSpeech = rows.filter(
		(r) => r.status === INTERACTION_STATUS_ENUM.NO_SPEECH,
	).length
	return {
		turns,
		earlyBargeInRate: rate(early, turns),
		lateBargeInRate: rate(bargeIns.length - early, turns),
		cutOffRate: rate(cutOff, spoken.length),
		perceivedTtfaP50: percentile(
			numbers(rows, (r) => r.perceivedTtfaMs),
			50,
		),
		eouDelayP50: percentile(
			numbers(rows, (r) => r.eouDelayMs),
			50,
		),
		noSpeechRate: rate(noSpeech, turns),
	}
}
