import { getTableColumns } from "drizzle-orm"

import { hostNode } from "@/db/schema"
import {
	MODEL_INSTALL_HARD_MAX_BYTES,
	NODE_LIVE_FIELDS,
	NODE_META_FIELDS,
	NODE_SUBSYSTEMS,
	nodeConfigBundleSchema,
	serializeNodeConfig,
} from "@/modules/node-config"
import { baseHostNode } from "@/test-utils/mocks"

import { makeChecker } from "./lib/assert"

const main = (): void => {
	const checker = makeChecker()
	const meta = new Set<string>(NODE_META_FIELDS)
	const columns = Object.keys(getTableColumns(hostNode)).filter(
		(c) => !meta.has(c),
	)
	const buckets = NODE_SUBSYSTEMS.map((subsystem) => ({
		subsystem,
		fields: NODE_LIVE_FIELDS[subsystem].map(String),
	}))

	for (const column of columns) {
		const hits = buckets.filter((b) => b.fields.includes(column))
		checker.check(
			`host_node.${column} classified exactly once`,
			hits.length === 1,
			`buckets=${hits.map((h) => h.subsystem).join(",") || "none"}`,
		)
	}

	for (const bucket of buckets)
		for (const field of bucket.fields)
			checker.check(
				`NODE_LIVE_FIELDS.${bucket.subsystem}.${field} is a host_node column`,
				columns.includes(field),
			)

	const row = baseHostNode()
	const snapshot = serializeNodeConfig(row)
	checker.check("serializeNodeConfig emits version 1", snapshot.version === 1)
	checker.check(
		"serializeNodeConfig emits every classified column",
		columns.every((c) => c in snapshot.node),
		Object.keys(snapshot.node).join(","),
	)
	checker.check(
		"serializeNodeConfig leaks no host_node meta column",
		[...meta].every((c) => !(c in snapshot.node)),
	)

	const roundTrip = nodeConfigBundleSchema.safeParse({
		version: snapshot.version,
		node: snapshot.node,
	})
	checker.check(
		"serialize → parse round trip",
		roundTrip.success &&
			JSON.stringify(roundTrip.data.node) === JSON.stringify(snapshot.node),
		roundTrip.success ? "" : JSON.stringify(roundTrip.error.issues),
	)

	const partial = nodeConfigBundleSchema.safeParse({
		node: { meshDropWarnWindowMs: 25_000 },
	})
	checker.check(
		"a partial node section parses",
		partial.success && partial.data.node?.meshDropWarnWindowMs === 25_000,
	)

	const overCap = nodeConfigBundleSchema.safeParse({
		node: { modelInstallMaxBytes: MODEL_INSTALL_HARD_MAX_BYTES + 1 },
	})
	checker.check(
		"a value above the hard cap is rejected",
		!overCap.success,
		overCap.success ? "accepted" : "",
	)

	const unknownField = nodeConfigBundleSchema.safeParse({
		node: { nope: 1 },
	})
	checker.check(
		"an unknown node field is rejected",
		!unknownField.success,
		unknownField.success ? "accepted" : "",
	)

	const identityField = nodeConfigBundleSchema.safeParse({
		node: { configRevision: 5 },
	})
	checker.check(
		"host_node meta columns are not writable",
		!identityField.success,
		identityField.success ? "accepted" : "",
	)

	const badUrl = nodeConfigBundleSchema.safeParse({
		node: { publicAudioBaseUrl: "ftp://nope" },
	})
	checker.check(
		"a non-http public audio base URL is rejected",
		!badUrl.success,
		badUrl.success ? "accepted" : "",
	)

	console.log(
		`\nnode-config: ${checker.passCount()} passed, ${checker.failCount()} failed`,
	)
	if (checker.failCount() > 0) process.exit(1)
}

main()
