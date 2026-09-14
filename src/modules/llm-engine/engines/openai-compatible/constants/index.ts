export const LLAMA_PROPS_PATH = "/props"
export const LLAMA_PROPS_TIMEOUT_MS = 2000
export const LLAMA_PROPS_FAILURE_TTL_MS = 30_000
export const LLAMA_HEALTH_PATH = "/health"

export const TOOL_CATALOG_HEADER =
	'You have access to the following functions. To call a function, respond with a JSON object of the form {"name": function name, "parameters": dictionary of argument name and its value}. To call several, separate the objects with a semicolon. Do not use variables. Never use function-call syntax like name(argument); always the JSON object.'
