import type { SelectHostNodeType } from "@/db"

export type NodeSubsystemType = "mesh" | "model-manager" | "audio"

export type NodeConfigType = Omit<
	SelectHostNodeType,
	"id" | "nodeId" | "configRevision" | "createdAt" | "updatedAt"
>

export type NodeConfigSnapshotType = {
	version: number
	revision: number
	node: NodeConfigType
}

export type NodeConfigApplyResultType = {
	applied: true
	revision: number
	changed: (keyof NodeConfigType)[]
	reloaded: NodeSubsystemType[]
}
