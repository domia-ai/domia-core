import { randomUUID } from "crypto"

import { isAuthExemptRequest } from "@/modules/http-api"
import { verifySatelliteToken } from "@/utils"

import { env } from "./lib/env"
import { meshHeaders } from "./lib/http"
import { makeChecker } from "./lib"

type RouteCheckType = {
	method: "GET" | "POST" | "PATCH"
	path: string
	body?: unknown
	expect: number[]
}

const key = env.EVAL_DOMIA_KEY
const ROUTES: RouteCheckType[] = [
	{ method: "GET", path: "/health", expect: [200] },
	{ method: "GET", path: "/config/schema", expect: [200] },
	{ method: "GET", path: `/config?domiaKey=${key}`, expect: [200] },
	{ method: "GET", path: `/config/health?domiaKey=${key}`, expect: [200] },
	{ method: "GET", path: `/skills?domiaKey=${key}`, expect: [200] },
	{ method: "GET", path: "/skills/descriptor-schema", expect: [200] },
	{ method: "GET", path: `/routines?domiaKey=${key}`, expect: [200] },
	{
		method: "POST",
		path: `/routines?domiaKey=${key}`,
		body: {},
		expect: [400],
	},
	{ method: "POST", path: "/satellite/token", body: {}, expect: [400] },
	{
		method: "POST",
		path: "/satellite/token",
		body: { domiaKey: "NOPE", satelliteId: "eval-satellite" },
		expect: [404],
	},
	{
		method: "POST",
		path: "/satellite/token",
		body: { domiaKey: key, satelliteId: "eval-satellite" },
		expect: [200],
	},
	{
		method: "POST",
		path: `/skills/fast-path/try?domiaKey=${key}`,
		body: {},
		expect: [400],
	},
	{
		method: "POST",
		path: "/skills/fast-path/try",
		body: { text: "what time is it" },
		expect: [400],
	},
	{
		method: "POST",
		path: `/skills/fast-path/try?domiaKey=${key}`,
		body: { text: "what time is it" },
		expect: [200],
	},
	{ method: "GET", path: `/satellites?domiaKey=${key}`, expect: [200] },
	{ method: "GET", path: "/identities", expect: [200] },
	{ method: "GET", path: "/templates", expect: [200] },
	{ method: "GET", path: `/proactivity/status?domiaKey=${key}`, expect: [200] },
	{
		method: "GET",
		path: `/proactivity/schedule?domiaKey=${key}`,
		expect: [200],
	},
	{ method: "GET", path: `/stats/latency?domiaKey=${key}`, expect: [200] },
	{ method: "GET", path: `/voice-feel?domiaKey=${key}`, expect: [200] },
	{
		method: "POST",
		path: `/voice-feel/apply/eval-unknown?domiaKey=${key}`,
		body: {},
		expect: [404],
	},
	{
		method: "POST",
		path: `/voice-feel/revert/eval-unknown?domiaKey=${key}`,
		body: {},
		expect: [404],
	},
	{
		method: "POST",
		path: `/mesh/rotate?domiaKey=${key}`,
		body: { action: "status" },
		expect: [200],
	},
	{
		method: "POST",
		path: `/bench/run?domiaKey=${key}`,
		body: { turns: 0 },
		expect: [400],
	},
	{
		method: "PATCH",
		path: `/satellites/eval-unknown/settings?domiaKey=${key}`,
		body: {},
		expect: [400],
	},
	{
		method: "PATCH",
		path: `/satellites/eval-unknown/settings?domiaKey=${key}`,
		body: { followUpNoSpeechMs: 8000 },
		expect: [404],
	},
	{ method: "GET", path: `/memory/episodes?domiaKey=${key}`, expect: [200] },
	{ method: "GET", path: "/memory/episodes", expect: [400] },
	{ method: "GET", path: "/memory/episodes?domiaKey=NOPE", expect: [404] },
	{ method: "GET", path: `/memory/user-model?domiaKey=${key}`, expect: [200] },
	{ method: "GET", path: "/memory/user-model", expect: [400] },
	{ method: "GET", path: "/memory/user-model?domiaKey=NOPE", expect: [404] },
	{
		method: "GET",
		path: `/memory/facts/eval-unknown/evidence?domiaKey=${key}`,
		expect: [404],
	},
	{ method: "GET", path: "/memory/facts/eval-unknown/evidence", expect: [400] },
	{
		method: "GET",
		path: "/memory/facts/eval-unknown/evidence?domiaKey=NOPE",
		expect: [404],
	},
	{ method: "GET", path: `/tool-runs?domiaKey=${key}`, expect: [200] },
	{ method: "GET", path: "/tool-runs", expect: [400] },
	{ method: "GET", path: "/tool-runs?domiaKey=NOPE", expect: [404] },
	{
		method: "GET",
		path: `/tool-runs?domiaKey=${key}&status=nope`,
		expect: [400],
	},
	{ method: "GET", path: `/confirmations?domiaKey=${key}`, expect: [200] },
	{
		method: "POST",
		path: "/admin/reset-conversation",
		body: {},
		expect: [400],
	},
	{
		method: "POST",
		path: "/admin/reset-conversation?domiaKey=NOPE",
		body: {},
		expect: [404],
	},
	{ method: "GET", path: "/confirmations", expect: [400] },
	{ method: "GET", path: "/confirmations?domiaKey=NOPE", expect: [404] },
	{
		method: "POST",
		path: `/confirmations/eval-unknown/settle?domiaKey=${key}`,
		body: { decision: "no" },
		expect: [404],
	},
	{
		method: "POST",
		path: `/confirmations/eval-unknown/settle?domiaKey=${key}`,
		body: {},
		expect: [400],
	},
	{
		method: "POST",
		path: "/confirmations/eval-unknown/settle",
		body: { decision: "no" },
		expect: [400],
	},
	{ method: "GET", path: `/mind?domiaKey=${key}`, expect: [200] },
	{ method: "GET", path: `/mind/export?domiaKey=${key}`, expect: [200] },
	{
		method: "GET",
		path: `/mind/export?domiaKey=${key}&sections=memory_fact,knowledge_entry`,
		expect: [200],
	},
	{
		method: "GET",
		path: `/mind/export?domiaKey=${key}&sections=not_a_table`,
		expect: [400],
	},
	{ method: "GET", path: "/mind/export?domiaKey=NOPE", expect: [404] },
	{
		method: "POST",
		path: `/mind/import?domiaKey=${key}`,
		body: { bundle: { version: 99 } },
		expect: [400],
	},
	{
		method: "POST",
		path: `/mind/import?domiaKey=${key}`,
		body: {
			bundle: {
				version: 1,
				exportedAt: "2026-01-01T00:00:00.000Z",
				sourceDomiaKey: key,
				sections: { interaction_trace: { columns: ["id"], rows: [] } },
			},
		},
		expect: [400],
	},
	{
		method: "POST",
		path: `/mind/import?domiaKey=${key}`,
		body: {
			bundle: {
				version: 1,
				exportedAt: "2026-01-01T00:00:00.000Z",
				sourceDomiaKey: key,
				sections: {},
			},
			sections: ["not_a_table"],
		},
		expect: [400],
	},
	{
		method: "POST",
		path: `/mind/import?domiaKey=${key}`,
		body: {
			bundle: {
				version: 1,
				exportedAt: "2026-01-01T00:00:00.000Z",
				sourceDomiaKey: key,
				sections: {},
			},
			mode: "sideways",
		},
		expect: [400],
	},
	{ method: "GET", path: "/node/config", expect: [200] },
	{ method: "POST", path: "/node/config", body: {}, expect: [200] },
	{
		method: "POST",
		path: "/node/config",
		body: { node: { modelInstallMaxConcurrentJobs: 0 } },
		expect: [400],
	},
	{ method: "GET", path: "/config?domiaKey=NOPE", expect: [404] },
	{ method: "GET", path: "/skills", expect: [400] },
]

const main = async (): Promise<void> => {
	const checker = makeChecker()
	for (const route of ROUTES) {
		const res = await fetch(`${env.EVAL_URL}${route.path}`, {
			method: route.method,
			headers: { "content-type": "application/json", ...meshHeaders() },
			body: route.body === undefined ? undefined : JSON.stringify(route.body),
		})
		checker.check(
			`${route.method} ${route.path.split("?")[0]} → ${route.expect.join("|")}`,
			route.expect.includes(res.status),
			`got ${res.status}`,
		)
	}
	const nodeConfig = (await (
		await fetch(`${env.EVAL_URL}/node/config`, { headers: meshHeaders() })
	).json()) as { version?: number; revision?: number; node?: object }
	checker.check(
		"GET /node/config returns version 1 and a node section",
		nodeConfig.version === 1 &&
			typeof nodeConfig.revision === "number" &&
			typeof nodeConfig.node === "object",
		JSON.stringify(nodeConfig),
	)
	const nodeNoOp = (await (
		await fetch(`${env.EVAL_URL}/node/config`, {
			method: "POST",
			headers: { "content-type": "application/json", ...meshHeaders() },
			body: JSON.stringify({}),
		})
	).json()) as { applied?: boolean; changed?: string[]; reloaded?: string[] }
	checker.check(
		"POST /node/config {} is a no-op apply",
		nodeNoOp.applied === true &&
			nodeNoOp.changed?.length === 0 &&
			nodeNoOp.reloaded?.length === 0,
		JSON.stringify(nodeNoOp),
	)

	const schema = (await (
		await fetch(`${env.EVAL_URL}/config/schema`, { headers: meshHeaders() })
	).json()) as {
		sections: { fields: { key: string; secret: boolean; default: unknown }[] }[]
	}
	checker.check(
		"config schema never returns a default for a secret field",
		schema.sections.every((s) =>
			s.fields.every((f) => !f.secret || f.default === null),
		),
	)
	const meshGrace = schema.sections
		.flatMap((s) => s.fields)
		.find((f) => f.key === "meshSecretGraceMs")
	checker.check(
		"meshSecretGraceMs is not secret",
		meshGrace !== undefined &&
			!meshGrace.secret &&
			meshGrace.default !== null &&
			meshGrace.default !== undefined,
		JSON.stringify(meshGrace ?? null),
	)
	const secrets = schema.sections.flatMap((s) =>
		s.fields.filter((f) => f.secret).map((f) => f.key),
	)
	checker.check(
		"config schema still marks the real credential columns as secret",
		["apiKey", "password"].every((k) => secrets.includes(k)),
		secrets.join(","),
	)

	const minted = (await (
		await fetch(`${env.EVAL_URL}/satellite/token`, {
			method: "POST",
			headers: { "content-type": "application/json", ...meshHeaders() },
			body: JSON.stringify({
				domiaKey: key,
				satelliteId: "eval-satellite",
			}),
		})
	).json()) as { token?: string; expiresAt?: number }
	checker.check(
		"POST /satellite/token returns a scoped token and a future expiry",
		typeof minted.token === "string" &&
			minted.token.split(".").length === 2 &&
			typeof minted.expiresAt === "number" &&
			minted.expiresAt > Date.now(),
		JSON.stringify(minted),
	)
	checker.check(
		"the minted token verifies for its pair and no other",
		verifySatelliteToken(minted.token, {
			domiaKey: key,
			satelliteId: "eval-satellite",
		}) &&
			!verifySatelliteToken(minted.token, {
				domiaKey: key,
				satelliteId: "eval-other",
			}),
	)

	const tried = (await (
		await fetch(`${env.EVAL_URL}/skills/fast-path/try?domiaKey=${key}`, {
			method: "POST",
			headers: { "content-type": "application/json", ...meshHeaders() },
			body: JSON.stringify({ text: "what time is it" }),
		})
	).json()) as { verdict?: { kind?: string; fastPathMs?: number } }
	checker.check(
		"POST /skills/fast-path/try returns a verdict kind and its timing",
		["match", "compound", "miss"].includes(tried.verdict?.kind ?? "") &&
			typeof tried.verdict?.fastPathMs === "number",
		JSON.stringify(tried),
	)

	checker.check(
		"auth predicate: the new mint and dry-run routes need the mesh bearer",
		!isAuthExemptRequest("POST", "/satellite/token") &&
			!isAuthExemptRequest("POST", `/skills/fast-path/try?domiaKey=${key}`),
	)

	checker.check(
		"auth predicate: the memory, tool-run and confirmation routes need the mesh bearer",
		[
			["GET", `/memory/episodes?domiaKey=${key}`],
			["GET", `/memory/user-model?domiaKey=${key}`],
			["GET", `/memory/facts/abc/evidence?domiaKey=${key}`],
			["GET", `/tool-runs?domiaKey=${key}`],
			["GET", `/confirmations?domiaKey=${key}`],
			["POST", `/confirmations/local/settle?domiaKey=${key}`],
		].every(([method, path]) => !isAuthExemptRequest(method, path)),
	)

	const audioId = randomUUID()
	checker.check(
		"auth predicate: GET /audio/<id> (tts default) is bearer-exempt",
		isAuthExemptRequest("GET", `/audio/${audioId}`) &&
			isAuthExemptRequest("GET", `/audio/${audioId}?kind=tts`),
	)
	checker.check(
		"auth predicate: GET /audio/<id>?kind=announce is bearer-exempt",
		isAuthExemptRequest("GET", `/audio/${audioId}?kind=announce`),
	)
	checker.check(
		"auth predicate: GET /audio/<id>?kind=input requires the mesh bearer",
		!isAuthExemptRequest("GET", `/audio/${audioId}?kind=input`) &&
			!isAuthExemptRequest(
				"GET",
				`/audio/${audioId}?domiaKey=${key}&kind=input`,
			),
	)
	checker.check(
		"auth predicate: an unparseable audio kind is not exempt",
		!isAuthExemptRequest("GET", `/audio/${audioId}?kind=nope`),
	)
	const inputRes = await fetch(`${env.EVAL_URL}/audio/${audioId}?kind=input`, {
		headers: meshHeaders(),
	})
	checker.check(
		"GET /audio/<id>?kind=input with the mesh bearer → 404 (not 401)",
		inputRes.status === 404,
		`got ${inputRes.status}`,
	)
	console.log(
		`\nhttp-surface: ${checker.passCount()} passed, ${checker.failCount()} failed`,
	)
	if (checker.failCount() > 0) process.exit(1)
}

void main()
