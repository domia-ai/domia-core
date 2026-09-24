import type { SkillAdapterType } from "../types"
import { builtinAdapter } from "./builtin"
import { mcpV1SseAdapter } from "./mcp-v1-sse"
import { mcpV2Adapter } from "./mcp-v2"

const registry: SkillAdapterType[] = [
	mcpV2Adapter,
	mcpV1SseAdapter,
	builtinAdapter,
]

export const resolveSkillAdapter = (
	protocol: string,
	type?: string,
): SkillAdapterType | null =>
	registry.find(
		(adapter) =>
			adapter.protocol === protocol &&
			(type === undefined || adapter.transports.includes(type)),
	) ?? null
