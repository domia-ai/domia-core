import { WAKE_VERIFIER_ENUM } from "@/db"
import type { WakeVerifierEngineAdapterType } from "../../types"

export const noneWakeVerifier: WakeVerifierEngineAdapterType = {
	id: WAKE_VERIFIER_ENUM.NONE,
	verify: () =>
		Promise.resolve({ accepted: true, score: 1, detail: "no verifier" }),
}
