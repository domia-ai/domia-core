import { randomUUID } from "crypto"

import type { DomiaType } from "@/modules/core"
import type { SelectSkillProviderType, SkillToolType } from "@/db"
import {
	connectProvider,
	reconnectProviders,
	disconnectProviders,
	getConnectionsFor,
	callTool,
	type SkillConnHandleType,
} from "@/modules/skill-engine"
import { isDomiaError, SKILL_ERRORS } from "@/utils"

import { makeChecker, startMockHa } from "./lib"

const checker = makeChecker()

const DOMIA_ID = randomUUID()
const HOME_SLUG = "home"
const NOTES_SLUG = "notes"
const DEAD_URL = "http://127.0.0.1:1/mcp"

const toolsFor = (slug: string): SkillToolType[] => [
	{
		provider: slug,
		rawName: "GetLiveContext",
		namespacedName: `${slug}__GetLiveContext`,
		description: "Reads current state.",
		inputSchema: { type: "object", properties: {} },
	},
]

const providerCfg = (name: string, url: string): SelectSkillProviderType =>
	({
		id: randomUUID(),
		name,
		isActive: true,
		domiaId: DOMIA_ID,
		protocol: "mcp",
		type: "http",
		url,
		description: null,
		config: null,
		descriptor: {
			version: 1,
			execution: { toolPolicy: { GetLiveContext: "allow" } },
		},
		auth: null,
		toolsCache: toolsFor(name),
		toolWhitelist: null,
		lastSyncAt: null,
		maxResultChars: 4000,
		timeout: 3000,
		toolsRefreshMs: 300_000,
		priority: 0,
		trustTier: "untrusted",
		createdAt: "",
		updatedAt: "",
	}) as unknown as SelectSkillProviderType

const domiaWith = (providers: SelectSkillProviderType[]): DomiaType =>
	({
		id: DOMIA_ID,
		domiaKey: "SKILLS_RELOAD_TEST",
		characterProfile: { name: "Domia", language: "en" },
		skillProviders: providers,
	}) as unknown as DomiaType

const handleOf = (providerId: string): SkillConnHandleType | null =>
	getConnectionsFor(DOMIA_ID).find((c) => c.providerId === providerId)
		?.handle ?? null

const rejection = async (p: Promise<unknown>): Promise<unknown> =>
	p.then(
		() => null,
		(err: unknown) => err,
	)

const serves = async (slug: string): Promise<boolean> => {
	const res = await callTool(DOMIA_ID, `${slug}__GetLiveContext`, {})
	return res.status === "ok"
}

const main = async (): Promise<void> => {
	const original = await startMockHa(0)
	const replacement = await startMockHa(0)
	const notesServer = await startMockHa(0)

	const home = providerCfg(HOME_SLUG, original.url)
	const notes = providerCfg(NOTES_SLUG, notesServer.url)
	await connectProvider(home, HOME_SLUG, "en")
	await connectProvider(notes, NOTES_SLUG, "en")

	const homeHandle = handleOf(home.id)
	const notesHandle = handleOf(notes.id)
	checker.check(
		"both providers connected before the reload",
		homeHandle !== null && notesHandle !== null && (await serves(HOME_SLUG)),
	)

	console.log("\n[candidate fails] the old connection keeps serving")
	const broken = { ...home, url: DEAD_URL }
	const failure = await rejection(
		reconnectProviders(domiaWith([broken, notes]), [broken.id]),
	)
	checker.check(
		"a failing candidate throws SKILL/PROVIDER_NOT_READY",
		isDomiaError(failure) &&
			failure.code === SKILL_ERRORS.PROVIDER_NOT_READY.code,
		String(failure),
	)
	checker.check(
		"the old handle is still the registered one",
		handleOf(broken.id) === homeHandle,
	)
	checker.check(
		"the old connection still answers tool calls",
		await serves(HOME_SLUG),
	)

	console.log("\n[partial failure] no provider is swapped")
	const movedNotes = { ...notes, url: replacement.url }
	const partial = await rejection(
		reconnectProviders(domiaWith([broken, movedNotes]), [
			broken.id,
			movedNotes.id,
		]),
	)
	checker.check("a partial failure throws", isDomiaError(partial))
	checker.check(
		"the healthy provider keeps its original handle",
		handleOf(notes.id) === notesHandle,
	)
	checker.check(
		"the healthy provider still answers tool calls",
		await serves(NOTES_SLUG),
	)

	console.log("\n[candidate succeeds] the new connection takes over")
	const moved = { ...home, url: replacement.url }
	await reconnectProviders(domiaWith([moved, notes]), [moved.id])
	const swapped = handleOf(moved.id)
	checker.check(
		"the registry holds a new handle after the swap",
		swapped !== null && swapped !== homeHandle,
	)
	const closed = await rejection(
		homeHandle?.callTool("GetLiveContext", {}) ?? Promise.resolve(),
	)
	checker.check(
		"the replaced handle is closed",
		closed !== null,
		String(closed),
	)
	checker.check(
		"the untouched provider keeps its handle",
		handleOf(notes.id) === notesHandle,
	)
	await original.close()
	checker.check(
		"the new connection serves after the old server is gone",
		await serves(HOME_SLUG),
	)

	await disconnectProviders([home.id, notes.id])
	await replacement.close()
	await notesServer.close()

	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} skills-reload checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
