import { LLM_ENGINE_ENUM } from "@/db"
import { SKILLS_CLAUSE } from "@/modules/agent"
import type {
	ChatMessageType,
	StreamReplyOrToolsType,
	ToolDefinitionType,
} from "@/modules/llm-engine"
import { openAiCompatibleEngine } from "@/modules/llm-engine/engines/openai-compatible"
import { getDomia } from "@/test-utils"

import { env, makeChecker, queryOne } from "./lib"
import type { GrammarProbeCaseType } from "./types"

const SAMPLES = 5

const DECISION_TOOLS: ToolDefinitionType[] = [
	{
		name: "HassTurnOn",
		description: "Turns on/opens/presses a device or entity.",
		parameters: {
			type: "object",
			properties: { name: { type: "string" }, area: { type: "string" } },
			required: ["name"],
		},
	},
	{
		name: "HassTurnOff",
		description: "Turns off/closes a device or entity.",
		parameters: {
			type: "object",
			properties: { name: { type: "string" }, area: { type: "string" } },
			required: ["name"],
		},
	},
	{
		name: "GetLiveContext",
		description:
			"Provides real-time information about the CURRENT state of devices, entities or areas.",
		parameters: {
			type: "object",
			properties: { name: { type: "string" }, area: { type: "string" } },
		},
	},
	{
		name: "GetDateTime",
		description: "Returns the current date and time.",
		parameters: { type: "object", properties: {} },
	},
]

const FINALIZE_TOOLS: ToolDefinitionType[] = [
	...DECISION_TOOLS,
	{
		name: "HassCancelAllTimers",
		description: "Cancels all timers in an area.",
		parameters: {
			type: "object",
			properties: { area: { type: "string" } },
		},
	},
]

const CASES: GrammarProbeCaseType[] = [
	{
		name: "compound: two lights",
		text: "Turn on the kitchen island pendants and the main lights",
		expect: "calls",
		minHits: 4,
	},
	{
		name: "compound: garage door and front lock",
		text: "Turn off the garage door and lock the front door",
		expect: "calls",
		minHits: 4,
	},
	{
		name: "polite modal: can you turn off the office lights",
		text: "can you turn off the office lights?",
		expect: "calls",
		tools: ["HassTurnOff"],
		minHits: 4,
	},
	{
		name: "state question: office light",
		text: "Is the office light on?",
		expect: "calls",
		tools: ["GetLiveContext"],
		minHits: 4,
	},
	{
		name: "state question: which lights are on",
		text: "Which lights are on right now?",
		expect: "calls",
		tools: ["GetLiveContext"],
		minHits: 4,
	},
	{
		name: "chat: one-line joke",
		text: "Tell me a one-line joke",
		expect: "text",
		minHits: 3,
	},
	{
		name: "clock: what time is it",
		text: "What time is it?",
		expect: "calls",
		tools: ["GetDateTime"],
		minHits: 4,
	},
]

const liveLlmConfig = ():
	| {
			base_url: string
			model_name: string
			tool_model_name: string | null
			slot_affinity_enabled: number
			engine: string
	  }
	| undefined =>
	queryOne(
		`SELECT lmc.base_url, lmc.model_name, lmc.tool_model_name, lmc.slot_affinity_enabled, lmc.engine
		 FROM llm_model_config lmc
		 JOIN domia d ON d.id = lmc.domia_id
		 WHERE d.domia_key = ? AND lmc.is_active = 1 LIMIT 1`,
		[env.EVAL_DOMIA_KEY],
	)

const systemMessage = (): ChatMessageType => ({
	role: "system",
	content: `${SKILLS_CLAUSE}\n\nYou are Domia. When you are not calling a tool, answer in one short sentence.`,
})

const main = async (): Promise<void> => {
	const config = liveLlmConfig()
	if (config?.engine !== LLM_ENGINE_ENUM.OPENAI_COMPATIBLE) {
		console.log(
			`⏭️  tool-grammar-llm SKIPPED — ${env.EVAL_DOMIA_KEY} is not on the openai-compatible engine (got ${config?.engine ?? "no config"})`,
		)
		process.exit(0)
	}
	const domia = getDomia({
		llmModelConfigOverrides: {
			engine: LLM_ENGINE_ENUM.OPENAI_COMPATIBLE,
			baseUrl: config.base_url,
			modelName: config.model_name,
			toolModelName: config.tool_model_name,
			slotAffinityEnabled: config.slot_affinity_enabled === 1,
		},
	})
	const { check, passCount, failCount } = makeChecker()
	console.log(
		`engine=${config.engine} baseUrl=${config.base_url} model=${config.tool_model_name ?? config.model_name}\n`,
	)

	let rejections = 0
	for (const c of CASES) {
		const shapes: string[] = []
		let hits = 0
		for (let i = 0; i < SAMPLES; i++) {
			try {
				const decision = await openAiCompatibleEngine.runWithTools?.(
					domia,
					[systemMessage(), { role: "user", content: c.text }],
					DECISION_TOOLS,
				)
				if (decision?.kind === "tool_calls") {
					const names = decision.calls.map((x) => x.name)
					shapes.push(`calls:${names.join("+")}`)
					if (c.expect === "calls") {
						const ok = c.tools
							? c.tools.every((t) => names.includes(t))
							: names.length >= 2
						if (ok) hits++
					}
				} else {
					shapes.push("text")
					if (c.expect === "text") hits++
				}
			} catch (error) {
				rejections++
				shapes.push(`error:${(error as Error).message.slice(0, 60)}`)
			}
		}
		const want =
			c.expect === "text" ? "plain text" : (c.tools?.join("+") ?? ">=2 calls")
		check(
			`${c.name} → ${want} ${hits}/${SAMPLES} (need ${c.minHits})`,
			hits >= c.minHits,
			shapes.join(" | "),
		)
		console.log(`     ${shapes.join(" | ")}`)
	}
	check(
		"zero engine rejections across all samples",
		rejections === 0,
		`rejections=${rejections}`,
	)

	const drainReply = async (
		out: StreamReplyOrToolsType,
	): Promise<{ kind: string; text: string; tokens: number }> => {
		if (out.kind === "tool_calls")
			return {
				kind: "tool_calls",
				text: out.calls.map((c) => c.name).join("+"),
				tokens: 0,
			}
		let text = ""
		let tokens = 0
		for await (const token of out.tokens) {
			text += token
			tokens++
		}
		return { kind: "reply", text, tokens }
	}

	const finalizeMessages = (
		userText: string,
		calls: {
			name: string
			arguments: Record<string, unknown>
			result: string
		}[],
	): ChatMessageType[] => [
		systemMessage(),
		{ role: "user", content: userText },
		{
			role: "assistant",
			content: "",
			toolCalls: calls.map((c) => ({
				name: c.name,
				arguments: c.arguments,
			})),
		},
		...calls.map(
			(c): ChatMessageType => ({
				role: "tool",
				toolName: c.name,
				content: c.result,
			}),
		),
	]

	const runFinalize = async (
		label: string,
		messages: ChatMessageType[],
	): Promise<void> => {
		const shapes: string[] = []
		let errors = 0
		let replies = 0
		for (let i = 0; i < SAMPLES; i++) {
			try {
				const out = await openAiCompatibleEngine.runReplyStreamOrTools?.(
					domia,
					messages,
					FINALIZE_TOOLS,
				)
				if (!out) {
					errors++
					shapes.push("no-adapter")
					continue
				}
				const drained = await drainReply(out)
				if (drained.kind === "reply") {
					replies++
					shapes.push(`reply(${drained.tokens}t):${drained.text.slice(0, 34)}`)
				} else {
					shapes.push(`calls:${drained.text}`)
				}
			} catch (error) {
				errors++
				shapes.push(`error:${(error as Error).message.slice(0, 70)}`)
			}
		}
		check(
			`finalize ${label} → zero rejections ${SAMPLES - errors}/${SAMPLES}`,
			errors === 0,
			shapes.join(" | "),
		)
		check(
			`finalize ${label} → plain streamed text ${replies}/${SAMPLES} (need 4)`,
			replies >= 4,
			shapes.join(" | "),
		)
		console.log(`     ${shapes.join("\n     ")}`)
	}

	const decision = await openAiCompatibleEngine.runWithTools?.(
		domia,
		[systemMessage(), { role: "user", content: "turn off the office lights" }],
		DECISION_TOOLS,
	)
	const decided =
		decision?.kind === "tool_calls"
			? decision.calls[0]
			: { name: "HassTurnOff", arguments: { name: "office lights" } }
	check(
		"two-step scenario: step 1 produced a tool call",
		decision?.kind === "tool_calls",
		decision?.kind ?? "none",
	)
	await runFinalize(
		`after a real ${decided.name} decision`,
		finalizeMessages("turn off the office lights", [
			{
				name: decided.name,
				arguments: decided.arguments,
				result: '{"success": true, "targets": ["light.office"]}',
			},
		]),
	)
	await runFinalize(
		"of the timer sentence after HassCancelAllTimers",
		finalizeMessages("It's a timer for twelve minutes and thirty seconds", [
			{
				name: "HassCancelAllTimers",
				arguments: { area: "kitchen" },
				result: '{"success": true, "cancelled": 1}',
			},
		]),
	)
	await runFinalize(
		"after a COMPOUND decision (2 calls, 2 results)",
		finalizeMessages("turn off the kitchen lights and the office lights", [
			{
				name: "HassTurnOff",
				arguments: { name: "kitchen lights" },
				result: '{"success": true, "targets": ["light.kitchen"]}',
			},
			{
				name: "HassTurnOff",
				arguments: { name: "office lights" },
				result: '{"success": true, "targets": ["light.office"]}',
			},
		]),
	)

	console.log(`\n${passCount()}/${passCount() + failCount()} checks passed`)
	process.exit(failCount() === 0 ? 0 : 1)
}

void main()
