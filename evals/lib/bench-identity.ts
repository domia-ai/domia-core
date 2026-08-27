import { readFileSync } from "fs"
import path from "path"

import { env } from "./env"
import { meshHeaders } from "./http"

export const BENCH_DOMIA_KEY = "DOMIA_BENCH"

const post = async (
	pathname: string,
	body: unknown,
	method = "POST",
): Promise<{ status: number; json: Record<string, unknown> }> => {
	const res = await fetch(`${env.EVAL_URL}${pathname}`, {
		method,
		headers: { "content-type": "application/json", ...meshHeaders() },
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
	return { status: res.status, json }
}

const benchBundle = (): Record<string, unknown> => {
	const snappy = JSON.parse(
		readFileSync(path.resolve("templates/snappy.json"), "utf-8"),
	) as Record<string, unknown>
	return {
		version: snappy.version,
		capabilities: {
			wakeword: false,
			record: false,
			stt: false,
			intentDetection: false,
			intentExecution: false,
			promptGeneration: true,
			llm: true,
			tts: false,
			playback: false,
		},
		modules: {
			...(snappy.modules as Record<string, unknown>),
			reflectionOnlyWhenIdle: false,
		},
		llm: snappy.llm,
	}
}

export const ensureBenchIdentity = async (): Promise<void> => {
	const created = await post("/identities", {
		name: "Bench",
		domiaKey: BENCH_DOMIA_KEY,
	})
	if (created.status !== 200 && created.status !== 409) {
		throw new Error(
			`bench identity create failed: ${created.status} ${JSON.stringify(created.json)}`,
		)
	}
	const applied = await post(
		`/config?domiaKey=${encodeURIComponent(BENCH_DOMIA_KEY)}`,
		benchBundle(),
	)
	if (applied.status !== 200) {
		throw new Error(
			`bench config apply failed: ${applied.status} ${JSON.stringify(applied.json)}`,
		)
	}
	await post(
		`/config/refresh?domiaKey=${encodeURIComponent(BENCH_DOMIA_KEY)}`,
		undefined,
	)
}

export const wipeBenchData = async (): Promise<void> => {
	await post(
		`/identity-data?domiaKey=${encodeURIComponent(BENCH_DOMIA_KEY)}`,
		undefined,
		"DELETE",
	)
}

export const teardownBenchIdentity = async (): Promise<void> => {
	await wipeBenchData()
	const removed = await post(
		`/identities/${encodeURIComponent(BENCH_DOMIA_KEY)}`,
		undefined,
		"DELETE",
	)
	if (removed.status !== 200 && removed.status !== 404) {
		throw new Error(
			`bench identity retire failed: ${removed.status} ${JSON.stringify(removed.json)}`,
		)
	}
}
