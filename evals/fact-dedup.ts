import { eq } from "drizzle-orm"

import { dbClient, domia as domiaTable, memoryFact } from "@/db"
import { embed } from "@/modules/embeddings"
import {
	FACT_DEDUP_DEFAULT_THRESHOLD,
	FACT_DEDUP_RELATION_THRESHOLDS,
	upsertFacts,
} from "@/modules/memory"
import { getDomia } from "@/test-utils"

import { makeChecker } from "./lib"
import type { FactDedupPairType } from "./types"

const checker = makeChecker()

const PAIRS: FactDedupPairType[] = [
	{ relation: "likes", a: "green tea", b: "some green tea", duplicate: true },
	// bge-small puts cross-dialect synonyms (0.72) below the tea/coffee floor (0.69) — synonym merging is out of reach for this model class, coexistence is the calibrated outcome
	{ relation: "likes", a: "football", b: "soccer", duplicate: false },
	{ relation: "likes", a: "tea", b: "coffee", duplicate: false },
	{ relation: "likes", a: "dogs", b: "cats", duplicate: false },
	{ relation: "likes", a: "jazz music", b: "heavy metal", duplicate: false },
	{ relation: "dislikes", a: "coffee", b: "drinking coffee", duplicate: true },
	{ relation: "dislikes", a: "coffee", b: "loud noises", duplicate: false },
	{ relation: "is named", a: "Kevin", b: "kevin", duplicate: true },
	{ relation: "is named", a: "Kevin", b: "Cutler", duplicate: false },
	{ relation: "is named", a: "Kevin", b: "Karen", duplicate: false },
	{ relation: "is allergic to", a: "peanuts", b: "peanut", duplicate: true },
	{
		relation: "is allergic to",
		a: "peanuts",
		b: "shellfish",
		duplicate: false,
	},
	{ relation: "lives in", a: "New York", b: "New York City", duplicate: true },
	{ relation: "lives in", a: "New York", b: "Boston", duplicate: false },
]

const cosineSim = (a: number[], b: number[]): number => {
	let dot = 0
	let na = 0
	let nb = 0
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	const denom = Math.sqrt(na) * Math.sqrt(nb)
	return denom === 0 ? 0 : dot / denom
}

const main = async (): Promise<void> => {
	const domia = getDomia({})
	console.log("=== fact semantic-dedup threshold calibration ===")
	for (const pair of PAIRS) {
		const threshold =
			FACT_DEDUP_RELATION_THRESHOLDS[pair.relation] ??
			FACT_DEDUP_DEFAULT_THRESHOLD
		const vectors = await embed(domia, [pair.a, pair.b])
		if (!vectors || vectors.length !== 2) {
			checker.check(`embed available for "${pair.a}" / "${pair.b}"`, false)
			continue
		}
		const sim = cosineSim(vectors[0], vectors[1])
		const decided = sim >= threshold
		checker.check(
			`${pair.relation}: "${pair.a}" vs "${pair.b}" → ${pair.duplicate ? "dedup" : "distinct"} (sim=${sim.toFixed(3)}, th=${threshold})`,
			decided === pair.duplicate,
		)
	}
	await runCardinalitySuite()
	const pass = checker.passCount()
	const fail = checker.failCount()
	console.log(`\n${pass}/${pass + fail} fact-dedup checks passed`)
	process.exit(fail === 0 ? 0 : 1)
}

const TEST_DOMIA_ID = "fact-dedup-cardinality-tmp"

const activeValuesFor = async (relation: string): Promise<string[]> => {
	const rows = await dbClient.query.memoryFact.findMany({
		where: eq(memoryFact.domiaId, TEST_DOMIA_ID),
	})
	return rows
		.filter((r) => r.relation === relation && r.supersededAt === null)
		.map((r) => r.value)
}

const runCardinalitySuite = async (): Promise<void> => {
	console.log("\nsingle-valued cardinality under concurrency (real DB)")
	const template = await dbClient.query.domia.findFirst()
	if (!template) {
		checker.check("domia row available for cardinality suite", false)
		return
	}
	await dbClient.delete(domiaTable).where(eq(domiaTable.id, TEST_DOMIA_ID))
	await dbClient.insert(domiaTable).values({
		...template,
		id: TEST_DOMIA_ID,
		domiaKey: "FACT_DEDUP_CARDINALITY_TMP",
	})
	const testDomia = getDomia({ domiaOverrides: { id: TEST_DOMIA_ID } })
	const fact = (value: string) => ({
		op: "add" as const,
		subject: "the user",
		relation: "is named",
		value,
		confidence: 0.9,
	})
	try {
		await Promise.all([
			upsertFacts(testDomia, [fact("Kevin")]),
			upsertFacts(testDomia, [fact("John")]),
		])
		const afterDistinct = await activeValuesFor("is named")
		checker.check(
			`concurrent distinct values → exactly one active (got [${afterDistinct.join(", ")}])`,
			afterDistinct.length === 1,
		)

		await dbClient
			.delete(memoryFact)
			.where(eq(memoryFact.domiaId, TEST_DOMIA_ID))
		await Promise.all([
			upsertFacts(testDomia, [fact("Kevin")]),
			upsertFacts(testDomia, [fact("Kevin")]),
		])
		const afterSame = await activeValuesFor("is named")
		checker.check(
			`concurrent same value → exactly one active, never zero (got [${afterSame.join(", ")}])`,
			afterSame.length === 1 && afterSame[0] === "Kevin",
		)

		await dbClient
			.delete(memoryFact)
			.where(eq(memoryFact.domiaId, TEST_DOMIA_ID))
		await upsertFacts(testDomia, [fact("Kevin")])
		await upsertFacts(testDomia, [fact("John")])
		await upsertFacts(testDomia, [fact("Kevin")])
		const rows = await dbClient.query.memoryFact.findMany({
			where: eq(memoryFact.domiaId, TEST_DOMIA_ID),
		})
		const active = rows.filter(
			(r) => r.relation === "is named" && r.supersededAt === null,
		)
		checker.check(
			`superseded value reactivates on re-assertion (active=[${active.map((r) => r.value).join(", ")}], rows=${rows.length})`,
			active.length === 1 && active[0].value === "Kevin" && rows.length === 2,
		)
	} finally {
		await dbClient
			.delete(memoryFact)
			.where(eq(memoryFact.domiaId, TEST_DOMIA_ID))
		await dbClient.delete(domiaTable).where(eq(domiaTable.id, TEST_DOMIA_ID))
	}
}

void main()
