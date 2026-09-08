import { audioCaptureLogger } from "@/utils"
import { getWakeVerifier } from "../engines"
import type {
	WakeVerdictType,
	WakeVerifierConfigType,
	WakeVerifierInputType,
} from "../types"

export const verifyWake = async (
	input: WakeVerifierInputType,
	config: WakeVerifierConfigType,
): Promise<WakeVerdictType> => {
	const verifier = getWakeVerifier(config.wakeVerifier)
	if (!verifier) {
		audioCaptureLogger.warn("wake verifier unknown — accepting wake", {
			verifier: config.wakeVerifier,
		})
		return { accepted: true, score: 1, detail: "unknown verifier" }
	}
	try {
		return await verifier.verify(input, config)
	} catch (err) {
		audioCaptureLogger.warn("wake verifier failed — accepting wake", {
			verifier: verifier.id,
			err,
		})
		return { accepted: true, score: 1, detail: "verifier error" }
	}
}

export const wakeVerifierWindowBytes = (
	config: WakeVerifierConfigType,
	sampleRate: number,
): number => Math.floor((sampleRate * config.wakeVerifierWindowMs) / 1000) * 2
