import type {
	SelectSkillProviderType,
	ToolFinalizeMapType,
	SkillToolType,
} from "@/db"

export type ToolShortlistResultType = {
	tools: SkillToolType[]
	total: number
	dropped: number
	applied: boolean
}

export type SkillCallStatusType =
	| "ok"
	| "error"
	| "blocked"
	| "timeout"
	| "unauthorized"

export type SkillCallResultType = {
	text: string
	status: SkillCallStatusType
	isError: boolean
}

export type SkillToolPolicyType = Record<string, "allow" | "block">

export type RawSkillToolType = {
	name: string
	description?: string
	inputSchema?: Record<string, unknown>
}

export type SkillConnHandleType = {
	listTools: () => Promise<RawSkillToolType[]>
	callTool: (
		rawName: string,
		args: Record<string, unknown>,
	) => Promise<SkillCallResultType>
	close: () => Promise<void>
}

export type SkillAdapterType = {
	protocol: string
	connect: (cfg: SelectSkillProviderType) => Promise<SkillConnHandleType>
}

export type SkillConnectionType = {
	providerId: string
	providerSlug: string
	name: string
	maxResultChars: number
	timeoutMs: number
	allowedTools: Set<string>
	toolPolicy: SkillToolPolicyType | null
	toolFinalize: ToolFinalizeMapType | null
	handle: SkillConnHandleType
}
