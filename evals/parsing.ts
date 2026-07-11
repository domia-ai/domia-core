import { parseLlmJson } from "@/utils/llm-json"
import { downsamplePcm16, downmixToMonoPcm16 } from "@/utils"

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

const pcmChecks = (): { pass: number; total: number } => {
	const sine24k = Buffer.alloc(24000 * 2)
	for (let i = 0; i < 24000; i++) {
		sine24k.writeInt16LE(
			Math.round(Math.sin((2 * Math.PI * 440 * i) / 24000) * 8000),
			i * 2,
		)
	}
	const down = downsamplePcm16(sine24k, 24000, 16000)
	const stereo = Buffer.alloc(8)
	stereo.writeInt16LE(1000, 0)
	stereo.writeInt16LE(3000, 2)
	stereo.writeInt16LE(-2000, 4)
	stereo.writeInt16LE(2000, 6)
	const mono = downmixToMonoPcm16(stereo, 2)
	const checks: [string, boolean][] = [
		[
			"pcm: identity when rates equal",
			downsamplePcm16(sine24k, 16000, 16000) === sine24k,
		],
		["pcm: 24k→16k sample count = 2/3", down.length === 16000 * 2],
		["pcm: byte alignment even", down.length % 2 === 0],
		[
			"pcm: empty input → empty output",
			downsamplePcm16(Buffer.alloc(0), 24000, 16000).length === 0,
		],
		[
			"pcm: stereo downmix averages",
			mono.readInt16LE(0) === 2000 && mono.readInt16LE(2) === 0,
		],
		["pcm: mono passthrough", downmixToMonoPcm16(mono, 1) === mono],
	]
	let pass = 0
	for (const [name, ok] of checks) {
		if (ok) pass++
		console.log(`${ok ? "✅" : "❌"} ${name}`)
	}
	return { pass, total: checks.length }
}

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
	const pcm = pcmChecks()
	console.log(
		`\n${pass}/${cases.length} parsing + ${pcm.pass}/${pcm.total} pcm cases passed`,
	)
	process.exit(pass === cases.length && pcm.pass === pcm.total ? 0 : 1)
}

main()
