import { randomUUID } from "crypto"

import { isAuthExemptRequest } from "@/modules/http-api"

import { env } from "./lib/env"
import { meshHeaders } from "./lib/http"
import { makeChecker } from "./lib"

type RouteCheckType = {
	method: "GET" | "POST"
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
	{ method: "GET", path: "/config?domiaKey=NOPE", expect: [404, 500] },
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
