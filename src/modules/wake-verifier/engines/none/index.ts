import { WAKE_VERIFIER_ENUM } from "@/db"
import type { WakeVerifierEngineAdapterType } from "../../types"

export const noneWakeVerifier: WakeVerifierEngineAdapterType = {
	id: WAKE_VERIFIER_ENUM.NONE,
	concurrent: false,
	verify: () =>
		Promise.resolve({ accepted: true, score: 1, detail: "no verifier" }),
}
