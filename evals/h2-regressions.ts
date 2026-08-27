import { randomUUID } from "crypto"
import { eq, like } from "drizzle-orm"

import {
	dbClient,
	domia as domiaTable,
	interactionTrace,
	interactionSessionTrace,
	pendingConfirmationRow,
} from "@/db"
import {
	parkConfirmation,
	claimConfirmation,
	peekPendingConfirmation,
	rehydrateConfirmations,
	clearConfirmationsForDomia,
	confirmationScope,
} from "@/modules/agent"
import {
	lastActedEntity,
	resolveSpeakDelivery,
	registerSatelliteAnnouncer,
	unregisterSatelliteAnnouncer,
	registerSatelliteSink,
	unregisterSatelliteSink,
	presentElicit,
	registerInteractionRuntime,
	clearInteraction,
} from "@/modules/core-bus"
import type { InteractionRuntimeType } from "@/modules/core-bus"
import { runWithTraceContext } from "@/utils"
import type { StreamingSinkType } from "@/modules/core-bus"
import { cachedTtsPcmChunks } from "@/modules/tts-engine"
import type { TtsEngineAdapterType } from "@/modules/tts-engine"
import type { DomiaType } from "@/modules/core"

import { makeChecker } from "./lib"

const checker = makeChecker()

const CLAIM_KEY = "H2REG_CLAIM"
const REHYDRATE_KEY = "H2REG_REHYDRATE"

const confirmationChecks = async (): Promise<void> => {
	console.log("\ndurable confirmation: atomic claim is at-most-once")
	const scope = confirmationScope(CLAIM_KEY, undefined)
	parkConfirmation(scope, {
		tool: "reg__HassLockDoor",
		args: { name: "front door" },
		language: "en",
	})
	const first = claimConfirmation(scope, "approved")
	const second = claimConfirmation(scope, "approved")
	checker.check("first claim wins", first === true)
	checker.check("second claim on the same row loses", second === false)
	const row = await dbClient
		.select()
		.from(pendingConfirmationRow)
		.where(eq(pendingConfirmationRow.scope, scope))
	checker.check(
		"claimed row is settled approved (never rehydratable)",
		row[0]?.status === "approved" && row[0]?.settledAt !== null,
		`status=${row[0]?.status}`,
	)
	const restoredAfterClaim = await rehydrateConfirmations()
	checker.check(
		"rehydration ignores the claimed row",
		peekPendingConfirmation(scope) === null,
		`restored=${restoredAfterClaim}`,
	)

	console.log("\ndurable confirmation: rehydration restores a pending row")
	const scope2 = confirmationScope(REHYDRATE_KEY, undefined)
	dbClient
		.insert(pendingConfirmationRow)
		.values({
			scope: scope2,
			domiaKey: REHYDRATE_KEY,
			tool: "reg__HassLockDoor",
			args: { name: "back door" },
			resolvedArgs: null,
			summary: null,
			language: "en",
			reasked: false,
			expiresAt: Date.now() + 600_000,
			status: "pending",
			settledAt: null,
			settledBy: null,
		})
		.run()
	await rehydrateConfirmations()
	const restored = peekPendingConfirmation(scope2)
	checker.check(
		"restored confirmation is peekable with its tool",
		restored?.tool === "reg__HassLockDoor",
		`tool=${restored?.tool}`,
	)
	clearConfirmationsForDomia(CLAIM_KEY)
	clearConfirmationsForDomia(REHYDRATE_KEY)
	dbClient
		.delete(pendingConfirmationRow)
		.where(like(pendingConfirmationRow.scope, "H2REG_%"))
		.run()
}

const anaphoraChecks = async (): Promise<void> => {
	console.log("\nanaphora: last acted entity expires with the age window")
	const domiaRow = { id: randomUUID() }
	dbClient
		.insert(domiaTable)
		.values({
			id: domiaRow.id,
			name: "h2reg",
			domiaKey: `H2REG_${domiaRow.id.slice(0, 8)}`,
		})
		.run()
	const sessionTraceId = randomUUID()
	const sessionId = randomUUID()
	dbClient
		.insert(interactionSessionTrace)
		.values({ id: sessionTraceId, domiaId: domiaRow.id, sessionId })
		.run()
	const traceOf = (
		id: string,
		createdAt: string,
		name: string,
	): typeof interactionTrace.$inferInsert => ({
		id,
		domiaId: domiaRow.id,
		interactionSessionTraceId: sessionTraceId,
		sessionId,
		skillResponse: [
			{
				kind: "result",
				tool: "reg__HassTurnOn",
				status: "ok",
				durationMs: 5,
				summaryForLlm: "ok",
				args: { name },
				resolvedArgs: { name },
			},
		],
		createdAt,
		updatedAt: createdAt,
	})
	const sqlTs = (msAgo: number): string =>
		new Date(Date.now() - msAgo).toISOString().replace("T", " ").slice(0, 19)
	const freshId = randomUUID()
	const staleId = randomUUID()
	const fakeDomia = {
		id: domiaRow.id,
		llmModelConfig: { anaphoraMaxAgeMs: 120_000 },
	} as unknown as DomiaType
	dbClient
		.insert(interactionTrace)
		.values(traceOf(staleId, sqlTs(600_000), "Old Lamp"))
		.run()
	const stale = await lastActedEntity(fakeDomia)
	checker.check(
		"stale trace outside the window yields no entity",
		stale === null,
		`got=${stale}`,
	)
	dbClient
		.insert(interactionTrace)
		.values(traceOf(freshId, sqlTs(5_000), "Fresh Lamp"))
		.run()
	const fresh = await lastActedEntity(fakeDomia)
	checker.check(
		"fresh trace inside the window yields its entity",
		fresh === "Fresh Lamp",
		`got=${fresh}`,
	)
	dbClient
		.delete(interactionTrace)
		.where(eq(interactionTrace.id, freshId))
		.run()
	dbClient
		.delete(interactionTrace)
		.where(eq(interactionTrace.id, staleId))
		.run()
	dbClient
		.delete(interactionSessionTrace)
		.where(eq(interactionSessionTrace.id, sessionTraceId))
		.run()
	dbClient.delete(domiaTable).where(eq(domiaTable.id, domiaRow.id)).run()
}

const singleFlightChecks = async (): Promise<void> => {
	console.log("\nphrase cache: single-flight shares one synthesis")
	let synthCount = 0
	const chunkA = Buffer.from("aaaa")
	const chunkB = Buffer.from("bbbb")
	const adapter = {
		id: "mock-tts",
		capabilities: { streaming: true, sampleRate: 24000, channels: 1 },
		runStream: async function* () {
			synthCount++
			await new Promise((r) => setTimeout(r, 30))
			yield chunkA
			await new Promise((r) => setTimeout(r, 30))
			yield chunkB
		},
		run: async () => null,
	} as unknown as TtsEngineAdapterType
	const ttsDomia = {
		id: randomUUID(),
		ttsConfig: {
			phraseCacheEnabled: true,
			phraseCacheEntries: 8,
			phraseCacheMaxChars: 80,
			modelPath: "mock",
			language: "en",
			voiceName: "v",
			speed: 1,
			pitch: 1,
			silenceScale: 0.2,
		},
		moduleSettings: { emotionEngine: false },
		emotionState: null,
	} as unknown as DomiaType
	const collect = async (): Promise<Buffer[]> => {
		const out: Buffer[] = []
		for await (const c of cachedTtsPcmChunks(ttsDomia, adapter, "shared line"))
			out.push(c)
		return out
	}
	const [a, b] = await Promise.all([collect(), collect()])
	checker.check(
		"two concurrent consumers trigger exactly one synthesis",
		synthCount === 1,
		`synths=${synthCount}`,
	)
	checker.check(
		"both consumers receive the full audio",
		a.length === 2 && b.length === 2,
		`a=${a.length} b=${b.length}`,
	)

	console.log("\nphrase cache: aborted leader never starves the waiter")
	synthCount = 0
	const abortingLeader = async (): Promise<void> => {
		const iterator = cachedTtsPcmChunks(ttsDomia, adapter, "abandoned line")[
			Symbol.asyncIterator
		]()
		await iterator.next()
		await iterator.return?.(undefined)
	}
	const waiter = async (): Promise<Buffer[]> => {
		await new Promise((r) => setTimeout(r, 10))
		const out: Buffer[] = []
		for await (const c of cachedTtsPcmChunks(
			ttsDomia,
			adapter,
			"abandoned line",
		))
			out.push(c)
		return out
	}
	const [, waited] = await Promise.all([abortingLeader(), waiter()])
	checker.check(
		"waiter falls back to its own synthesis after leader abort",
		waited.length === 2,
		`chunks=${waited.length} synths=${synthCount}`,
	)
}

const targetingChecks = (): void => {
	console.log("\ntargeted speak: fail-closed satellite delivery")
	const KEY = "H2REG_SAT"
	const heard: string[] = []
	const announcerA = (): void => void heard.push("A")
	const announcerA2 = (): void => void heard.push("A2")
	const announcerB = (): void => void heard.push("B")
	const sinkOf = (label: string): StreamingSinkType =>
		({ label }) as unknown as StreamingSinkType
	const sinkA = sinkOf("sinkA")
	const sinkB = sinkOf("sinkB")
	registerSatelliteAnnouncer(KEY, announcerA, "sat-a")
	registerSatelliteAnnouncer(KEY, announcerB, "sat-b")
	registerSatelliteSink(KEY, sinkA, "sat-a")
	registerSatelliteSink(KEY, sinkB, "sat-b")
	try {
		const toA = resolveSpeakDelivery(KEY, {
			kind: "satellite",
			satelliteId: "sat-a",
		})
		heard.length = 0
		toA.announcer?.("url")
		checker.check(
			"target A delivers only to A",
			heard.join(",") === "A" && toA.sink === sinkA && !toA.allowLocal,
			`heard=${heard.join(",")}`,
		)
		const unknown = resolveSpeakDelivery(KEY, {
			kind: "satellite",
			satelliteId: "sat-zzz",
		})
		checker.check(
			"unknown target delivers to nobody (no broadcast, no local)",
			unknown.announcer === null &&
				unknown.sink === null &&
				!unknown.allowLocal,
		)
		registerSatelliteAnnouncer(KEY, announcerA2, "sat-a")
		const toBothA = resolveSpeakDelivery(KEY, {
			kind: "satellite",
			satelliteId: "sat-a",
		})
		heard.length = 0
		toBothA.announcer?.("url")
		checker.check(
			"two connections of A deliver to both A connections and never B",
			heard.sort().join(",") === "A,A2",
			`heard=${heard.join(",")}`,
		)
		const local = resolveSpeakDelivery(KEY, { kind: "local" })
		checker.check(
			"local target never reaches satellites",
			local.announcer === null && local.sink === null && local.allowLocal,
		)
		const broadcast = resolveSpeakDelivery(KEY)
		heard.length = 0
		broadcast.announcer?.("url")
		checker.check(
			"no target keeps the broadcast behavior",
			heard.length === 3,
			`heard=${heard.join(",")}`,
		)
	} finally {
		unregisterSatelliteAnnouncer(KEY, announcerA)
		unregisterSatelliteAnnouncer(KEY, announcerA2)
		unregisterSatelliteAnnouncer(KEY, announcerB)
		unregisterSatelliteSink(KEY, sinkA)
		unregisterSatelliteSink(KEY, sinkB)
	}
}

const elicitGhostSatelliteCheck = async (): Promise<void> => {
	console.log("\nelicitation: undelivered question cancels immediately")
	const interactionId = randomUUID()
	registerInteractionRuntime({
		envelope: {
			interactionId,
			originDomiaKey: "H2REG_ELICIT",
			runtimeDomiaKey: "H2REG_ELICIT",
			satelliteId: "ghost-sat",
			source: "satellite",
			input: { kind: "transcript", transcript: "lock the door" },
			requestedOutput: {},
		},
	} as unknown as InteractionRuntimeType)
	const elicitDomia = {
		id: randomUUID(),
		domiaKey: "H2REG_ELICIT",
		characterProfile: { language: "en" },
		runtimeCapabilities: {},
	} as unknown as DomiaType
	const start = Date.now()
	const result = await runWithTraceContext(
		{ interactionId, originDomiaKey: "H2REG_ELICIT" },
		() => presentElicit(elicitDomia, "Which door?", undefined),
	)
	const elapsed = Date.now() - start
	checker.check(
		"ghost-satellite elicit resolves cancel without waiting for the TTL",
		result.action === "cancel" && elapsed < 5000,
		`action=${result.action} elapsed=${elapsed}ms`,
	)
	clearInteraction(interactionId)
}

const main = async (): Promise<void> => {
	await confirmationChecks()
	await anaphoraChecks()
	await singleFlightChecks()
	targetingChecks()
	await elicitGhostSatelliteCheck()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} h2-regression checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

void main()
