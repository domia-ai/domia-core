import { WAKE_VERIFIER_ENUM } from "@/db"
import { pcm16Rms } from "@/utils"
import type { WakeVerifierEngineAdapterType } from "../../types"

const FRAME_MS = 20
const STEADY_NOISE_ACTIVE_FRACTION = 0.98
const STEADY_NOISE_PENALTY = 0.5

export const energyWakeVerifier: WakeVerifierEngineAdapterType = {
	id: WAKE_VERIFIER_ENUM.ENERGY,
	concurrent: false,
	verify: ({ pcm, sampleRate }, config) => {
		const frameBytes = Math.max(
			2,
			Math.floor((sampleRate * FRAME_MS) / 1000) * 2,
		)
		const frames = Math.floor(pcm.length / frameBytes)
		let activeFrames = 0
		for (let i = 0; i < frames; i++) {
			const frame = pcm.subarray(i * frameBytes, (i + 1) * frameBytes)
			if (pcm16Rms(frame) >= config.wakeVerifierMinRms) activeFrames++
		}
		const speechMs = activeFrames * FRAME_MS
		const activeFraction = frames === 0 ? 0 : activeFrames / frames
		const coverage = Math.min(
			1,
			speechMs / Math.max(1, config.wakeVerifierMinSpeechMs),
		)
		const score =
			activeFraction >= STEADY_NOISE_ACTIVE_FRACTION
				? coverage * STEADY_NOISE_PENALTY
				: coverage
		return Promise.resolve({
			accepted: score >= config.wakeVerifierMinScore,
			score,
			detail: `speechMs=${speechMs} activeFraction=${activeFraction.toFixed(2)} frames=${frames}`,
		})
	},
}
