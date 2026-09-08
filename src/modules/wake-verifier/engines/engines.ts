import { WAKE_VERIFIER_ENUM, type WakeVerifierEnumType } from "@/db"
import { noneWakeVerifier } from "./none"
import { energyWakeVerifier } from "./energy"
import type { WakeVerifierEngineAdapterType } from "../types"

export const wakeVerifierRegistry: Record<
	WakeVerifierEnumType,
	WakeVerifierEngineAdapterType
> = {
	[WAKE_VERIFIER_ENUM.NONE]: noneWakeVerifier,
	[WAKE_VERIFIER_ENUM.ENERGY]: energyWakeVerifier,
}

export const getWakeVerifier = (
	id: WakeVerifierEnumType,
): WakeVerifierEngineAdapterType | null =>
	(wakeVerifierRegistry as Partial<typeof wakeVerifierRegistry>)[id] ?? null
