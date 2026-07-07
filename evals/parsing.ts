import { parseLlmJson } from "@/utils/llm-json"

type ParsingCaseType = {
	name: string
	input: string
	expect: "parsed" | "repaired" | "failed"
}

const cases: ParsingCaseType[] = [
	{
		name: "clean object",
		input: '{"tool": true, "cause": "x"}',
		expect: "parsed",
	},
	{ name: "fenced json", input: '```json\n{"a": 1}\n```', expect: "parsed" },
	{
		name: "trailing prose",
		input: '{"a": 1}\n\nHere is my reasoning.',
		expect: "parsed",
	},
	{
		name: "leading prose",
		input: 'Sure! Here you go:\n{"a": 1}',
		expect: "parsed",
	},
	{ name: "array root", input: "[1,2,3]", expect: "parsed" },
	{
		name: "truncated string",
		input: '{"summary": "the user is happ',
		expect: "repaired",
	},
	{
		name: "truncated bracket",
		input: '{"facts": [{"s":"a","r":"b","v":"c"}',
		expect: "repaired",
	},
	{ name: "truncated literal", input: '{"tool": tru', expect: "repaired" },
	{
		name: "plain refusal",
		input: "I cannot help with that request.",
		expect: "failed",
	},
	{ name: "empty string", input: "", expect: "failed" },
	{
		name: "prose only",
		input: "The weather is nice today and I like it.",
		expect: "failed",
	},
	{ name: "number word", input: "forty-two", expect: "failed" },
	{ name: "bare word true", input: "true", expect: "failed" },
	{
		name: "markdown heading",
		input: "# Summary\nThe conversation went well.",
		expect: "failed",
	},
]

const main = (): void => {
	let pass = 0
	for (const c of cases) {
		const { state } = parseLlmJson(c.input)
		const ok = state === c.expect
		if (ok) pass++
		console.log(
			`${ok ? "✅" : "❌"} ${c.name}: got ${state} (expect ${c.expect})`,
		)
	}
	console.log(`\n${pass}/${cases.length} parsing cases passed`)
	process.exit(pass === cases.length ? 0 : 1)
}

main()
