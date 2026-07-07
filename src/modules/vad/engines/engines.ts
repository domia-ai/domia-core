import { VAD_ENGINE_ENUM, type VadEngineEnumType } from "@/db"
import { sileroVadEngine } from "./silero"
import type { VadEngineAdapterType } from "../types"

export const vadEngineRegistry: Record<
	VadEngineEnumType,
	VadEngineAdapterType
> = {
	[VAD_ENGINE_ENUM.SILERO]: sileroVadEngine,
}

export const getVadEngine = (
	id: VadEngineEnumType,
): VadEngineAdapterType | null => vadEngineRegistry[id] ?? null
