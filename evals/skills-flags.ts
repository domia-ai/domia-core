import { env } from "./lib/env"
import { meshHeaders, postChat, postModules, sleep } from "./lib/http"
import { makeChecker } from "./lib"

type SkillsStatusType = {
	skillsEngine: boolean
	builtinTools: boolean
	providers: { name: string; connected: boolean }[]
}

const BUILTIN_NAME = "domia"
const SETTLE_MS = 3000

const checker = makeChecker()

const skillsStatus = async (): Promise<SkillsStatusType> => {
	const res = await fetch(
		`${env.EVAL_URL}/skills?domiaKey=${env.EVAL_DOMIA_KEY}`,
		{ headers: meshHeaders() },
	)
	if (!res.ok) throw new Error(`GET /skills ${res.status}`)
	return (await res.json()) as SkillsStatusType
}

const builtinConnected = (status: SkillsStatusType): boolean =>
	status.providers.some((p) => p.name === BUILTIN_NAME && p.connected)

const mcpConnected = (status: SkillsStatusType): number =>
	status.providers.filter((p) => p.name !== BUILTIN_NAME && p.connected).length

const timeTurnMs = async (): Promise<number> => {
	const started = Date.now()
	await postChat("what time is it")
	return Date.now() - started
}

const main = async (): Promise<void> => {
	const initial = await skillsStatus()
	const mcpBefore = mcpConnected(initial)
	console.log(
		`\n[baseline] skillsEngine=${initial.skillsEngine} builtinTools=${initial.builtinTools} builtin=${builtinConnected(initial)} mcp=${mcpBefore}`,
	)
	try {
		console.log("\n[builtinTools off] the built-in provider disconnects")
		await postModules({ builtinTools: false })
		await sleep(SETTLE_MS)
		const off = await skillsStatus()
		checker.check("GET /skills reports builtinTools=false", !off.builtinTools)
		checker.check(
			"the built-in provider is not connected",
			!builtinConnected(off),
			JSON.stringify(off.providers),
		)
		checker.check(
			"MCP providers are untouched",
			mcpConnected(off) === mcpBefore,
			`${mcpConnected(off)} vs ${mcpBefore}`,
		)

		console.log("\n[builtinTools on] the built-in provider reconnects")
		await postModules({ builtinTools: true })
		await sleep(SETTLE_MS)
		const on = await skillsStatus()
		checker.check("GET /skills reports builtinTools=true", on.builtinTools)
		checker.check(
			"the built-in provider is connected again",
			builtinConnected(on),
			JSON.stringify(on.providers),
		)
		await timeTurnMs()
		const fast = await timeTurnMs()
		checker.check(
			"the time answers on the built-in fast path (< 500 ms)",
			fast < 500,
			`${fast}ms`,
		)

		console.log("\n[skillsEngine off] MCP disconnects, the built-in stays")
		await postModules({ skillsEngine: false })
		await sleep(SETTLE_MS)
		const mcpOff = await skillsStatus()
		checker.check("no MCP provider is connected", mcpConnected(mcpOff) === 0)
		checker.check(
			"the built-in provider is still connected",
			builtinConnected(mcpOff),
			JSON.stringify(mcpOff.providers),
		)
	} finally {
		await postModules({
			skillsEngine: initial.skillsEngine,
			builtinTools: initial.builtinTools,
		})
		await sleep(SETTLE_MS)
	}
	const restored = await skillsStatus()
	checker.check(
		"the original flags and connections are restored",
		restored.skillsEngine === initial.skillsEngine &&
			restored.builtinTools === initial.builtinTools &&
			builtinConnected(restored) === builtinConnected(initial) &&
			mcpConnected(restored) === mcpBefore,
		JSON.stringify(restored),
	)
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} skills-flags checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
