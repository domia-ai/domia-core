export const SKILLS_CLAUSE =
	"You have tools that perform real actions and read real state. When the user asks to do or check anything these tools cover, you MUST call the matching tool — never answer as if you had done it without calling, and never make up a result. Put the user's whole target exactly as they said it into the single most specific text field — usually `name` — and leave every other field empty; never guess a location, category, type, or any other parameter the user did not say. Do not split a target into separate parts. Only skip the tools for pure conversation (greetings, jokes, opinions). When the user asks for several actions at once, call every matching tool in the same response — they run together in one batch. After the tools run, confirm in one short sentence in the user's language. If a tool errors, apologize briefly and do not retry more than once."

export const AGENT_FAILURE_REPLY =
	"I tried to handle that but couldn't finish it — could you say it a different way?"

export const AGENT_ACTED_FAILURE_REPLY =
	"Done — though I had trouble putting together a reply. Let me know if it didn't go through."
