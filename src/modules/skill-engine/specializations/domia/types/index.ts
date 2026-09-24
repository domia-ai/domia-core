import type {
	FastPathIntentType,
	FastPathSlotType,
	RoutineStepType,
	SelectRoutineType,
	ToolFinalizeMapType,
	ToolHintOverrideType,
	ToolPolicyType,
} from "@/db"

import type { BuiltinToolPackType, BuiltinToolType } from "../../../types"

export type DomiaToolPackEntryType = {
	tool: BuiltinToolType
	pack: BuiltinToolPackType
}

export type DomiaDurationPartType = {
	amount: number
	unit: "hour" | "minute" | "second"
}

export type RoutineInputType = {
	id?: string
	slug: string
	name: string
	description: string
	isActive?: boolean
	phrases: Record<string, string[]>
	slots?: Record<string, FastPathSlotType> | null
	steps: RoutineStepType[]
	reply: Record<string, string>
}

export type RoutineSaveResultType = {
	routine: SelectRoutineType
	created: boolean
}

export type RoutineStepTargetType = {
	providerSlug: string
	rawName: string
}

export type DomiaRoutineBlocksType = {
	aliases: Record<string, string[]>
	toolHints: Record<string, ToolHintOverrideType>
	toolPolicy: Record<string, ToolPolicyType>
	finalize: ToolFinalizeMapType
	intents: FastPathIntentType[]
}
