import { type InsertInteractionTraceType } from "@/db"

export type NewInteractionDataType = Omit<
	InsertInteractionTraceType,
	"id" | "domiaId" | "sessionId" | "interactionSessionTraceId"
>
