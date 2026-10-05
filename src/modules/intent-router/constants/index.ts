export const TOOL_JUDGE_SYSTEM =
	'You are a fast router. The user is talking to a voice assistant. Decide whether the user is asking the assistant, right now, to do what one of the tools does. Statements about the past, opinions, stories and small talk are not requests, even when they mention the same words. Answer ONLY with JSON: {"tool": "<tool name>"} or {"tool": "none"}.'
export const TOOL_JUDGE_KEY = "tool"
export const TOOL_JUDGE_NONE = "none"
export const TOOL_JUDGE_PROMPT_MAX_CHARS = 16000
export const TOOL_JUDGE_DESCRIPTION_MAX_CHARS = 400
export const TOOL_JUDGE_TRIMMED_EXAMPLES = 2
